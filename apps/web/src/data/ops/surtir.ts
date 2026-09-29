// Lógica de surtido FEFO (first-expired, first-out).
// planSurtido: función PURA que sugiere lotes por caducidad ascendente.
// surtirPedido: confirma el surtido — descuenta lotes (+movimientos) y marca el
// pedido como Empacado. Conecta lotsStore + ordersStore.
import type { Lot, OrderItem } from '../types'
import { getSnapshotLots, consume, reloadInventory } from '../store/lotsStore'
import { markPacked, reloadOrders, type OrderWithItems } from '../store/ordersStore'
import { hasSupabase } from '../../lib/supabase'
import { runW1Command, newOpId } from './w1Command'

export interface Alloc {
  lot: Lot
  qty: number
}

export interface ItemPlan {
  item: OrderItem
  allocations: Alloc[]
  shortfall: number // unidades que faltan (sin stock suficiente)
}

// Orden FEFO: caduca antes primero; sin fecha al final.
function byExpiry(a: Lot, b: Lot): number {
  if (!a.expiry_date) return 1
  if (!b.expiry_date) return -1
  return a.expiry_date < b.expiry_date ? -1 : a.expiry_date > b.expiry_date ? 1 : 0
}

// Núcleo FEFO reutilizable: asigna `qty` de un producto desde sus lotes,
// caducando primero. Lo usan Surtido (Almacén) y Punto de Venta.
export function allocateFEFO(productId: string, qty: number, lots: Lot[]): { allocations: Alloc[]; shortfall: number } {
  const today = new Date().toISOString().slice(0, 10)
  // No surtir/vender producto YA caducado (regulado). Solo lotes vigentes con stock.
  const avail = lots
    .filter((l) => l.product_id === productId && l.quantity > 0 && !(l.expiry_date != null && l.expiry_date < today))
    .sort(byExpiry)
  let need = qty
  const allocations: Alloc[] = []
  for (const lot of avail) {
    if (need <= 0) break
    const take = Math.min(need, lot.quantity)
    allocations.push({ lot, qty: take })
    need -= take
  }
  return { allocations, shortfall: Math.max(0, need) }
}

export function planSurtido(order: OrderWithItems, lots: Lot[]): ItemPlan[] {
  return order.items.map((item) => {
    const { allocations, shortfall } = allocateFEFO(item.product_id ?? '', item.qty, lots)
    return { item, allocations, shortfall }
  })
}

// ¿Se puede surtir? Debe haber renglones y todos con stock suficiente.
export function canFulfill(plans: ItemPlan[]): boolean {
  return plans.length > 0 && plans.every((p) => p.shortfall === 0)
}

export interface SurtirResult { ok: boolean; plans: ItemPlan[]; error?: string; ambiguous?: boolean }

// Confirma el surtido FEFO del pedido.
// W1 (con backend): comando `surtir_pedido` con asignaciones POR RENGLÓN (order_item_id +
// lote + qty). El servidor valida renglón, producto, caducidad, cobertura exacta y stock,
// descuenta y marca empacado en UNA transacción. SIN éxito optimista: la pantalla solo
// refleja lo confirmado. `opId` estable ⇒ un reintento no descuenta dos veces.
export async function surtirPedido(order: OrderWithItems, opId: string = newOpId()): Promise<SurtirResult> {
  // Idempotencia: si el pedido YA se surtió/avanzó, no volver a descontar (evita el
  // doble consumo por doble-click o dos usuarios de almacén sobre el mismo pedido).
  if (['packed', 'shipped', 'delivered', 'fulfilled', 'cancelled'].includes(order.status ?? '')) {
    return { ok: false, plans: [], error: 'Ese pedido ya fue surtido o cerrado.' }
  }
  // Debe estar en estado EMPACABLE (pagado). Validarlo ANTES de consumir evita descontar
  // inventario de un pedido que luego no se empacaría.
  if (!['paid', 'picking'].includes(order.status ?? '')) {
    return { ok: false, plans: [], error: 'Ese pedido todavía no se puede surtir (debe estar pagado).' }
  }
  const plans = planSurtido(order, getSnapshotLots())
  if (!canFulfill(plans)) return { ok: false, plans, error: 'No hay existencia suficiente para surtir este pedido.' }

  const itemLot: Record<string, string | null> = {}
  plans.forEach((p) => { itemLot[p.item.id] = p.allocations[0]?.lot.id ?? null })

  if (hasSupabase) {
    const allocations = plans.flatMap((p) => p.allocations.map((a) => ({ order_item_id: p.item.id, lot_id: a.lot.id, qty: a.qty })))
    const r = await runW1Command('surtir_pedido', { p_op_id: opId, p_order: order.id, p_allocations: allocations }, opId)
    if (!r.ok) { reloadInventory(); reloadOrders(); return { ok: false, plans, error: r.error, ambiguous: r.ambiguous } }
    // Confirmado por el servidor: aviso/auditoría locales y recarga de la verdad.
    markPacked(order.id, itemLot, true)
    reloadInventory(); reloadOrders()
    return { ok: true, plans }
  }

  // Modo demo (sin backend): descuento local síncrono.
  const allocations = plans.flatMap((p) => p.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty })))
  consume(allocations, order.external_ref ?? order.id, 'surtido', true)
  markPacked(order.id, itemLot, true)
  return { ok: true, plans }
}

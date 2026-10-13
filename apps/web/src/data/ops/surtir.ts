// Lógica de surtido FEFO (first-expired, first-out).
// planSurtido: función PURA que sugiere lotes por caducidad ascendente.
// surtirPedido: confirma el surtido — descuenta lotes (+movimientos) y marca el
// pedido como Empacado. Conecta lotsStore + ordersStore.
import type { Lot, OrderItem } from '../types'
import { getSnapshotLots, consume, reloadInventory } from '../store/lotsStore'
import { getDisponibleSnapshot, reloadCustody } from '../store/custodyStore'
import { markPacked, reloadOrders, type OrderWithItems } from '../store/ordersStore'
import { hasSupabase } from '../../lib/supabase'
import { runW1Command, newOpId } from './w1Command'
import { hoyNegocio } from '../periodo'

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

// W2-C · Unidades del lote que están EN CUSTODIA (con un vendedor o en un evento).
// `lots.quantity` es la existencia PROPIA e incluye la custodia, así que la cantidad
// asignable es propio − en custodia. El mapa lo pone el servidor (v_stock_disponible);
// si no llega, se asume 0 y el servidor sigue siendo la barrera real (piso de custodia
// en surtir_pedido, vender_pos y ajustar_lote).
export type EnCustodia = Record<string, number>

export const disponibleDeLote = (lot: Lot, enCustodia: EnCustodia = {}): number =>
  Math.max(0, lot.quantity - (enCustodia[lot.id] ?? 0))

// Mapa lote → unidades en custodia, leído de la autoridad del servidor.
export function mapaEnCustodia(): EnCustodia {
  const m: EnCustodia = {}
  getDisponibleSnapshot().forEach((d) => { if (d.en_custodia > 0) m[d.lot_id] = d.en_custodia })
  return m
}

// Núcleo FEFO reutilizable: asigna `qty` de un producto desde sus lotes, caducando
// primero y SOLO contra lo disponible. Lo usan Surtido (Almacén) y Punto de Venta.
export function allocateFEFO(productId: string, qty: number, lots: Lot[], enCustodia: EnCustodia = {}): { allocations: Alloc[]; shortfall: number } {
  const today = hoyNegocio()
  // No surtir/vender producto YA caducado (regulado) ni unidades que están en custodia.
  const avail = lots
    .filter((l) => l.product_id === productId && !(l.expiry_date != null && l.expiry_date < today))
    .map((l) => ({ lot: l, libre: disponibleDeLote(l, enCustodia) }))
    .filter((x) => x.libre > 0)
    .sort((a, b) => byExpiry(a.lot, b.lot))
  let need = qty
  const allocations: Alloc[] = []
  for (const { lot, libre } of avail) {
    if (need <= 0) break
    const take = Math.min(need, libre)
    allocations.push({ lot, qty: take })
    need -= take
  }
  return { allocations, shortfall: Math.max(0, need) }
}

export function planSurtido(order: OrderWithItems, lots: Lot[], enCustodia: EnCustodia = {}): ItemPlan[] {
  return order.items.map((item) => {
    const { allocations, shortfall } = allocateFEFO(item.product_id ?? '', item.qty, lots, enCustodia)
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
  // W2 · F-7: se surte lo LIBERADO (cobro suficiente o crédito autorizado), no lo "marcado como pagado". Desde W2 el
  // cobro vive en el libro y en `payment_status`; `orders.status` sigue en `pending_payment` hasta empacar. Por eso el
  // estado admitido es el MISMO que el del servidor (`surtir_pedido`): pending_payment | paid | picking.
  // Con backend, si está liberado lo decide el servidor (PEDIDO_NO_LIBERADO); en demo, lo único observable es el pago.
  const estado = order.status ?? ''
  const liberadoDemo = ['paid', 'picking'].includes(estado) || order.payment_status === 'paid'
  if (!['pending_payment', 'paid', 'picking'].includes(estado) || (!hasSupabase && !liberadoDemo)) {
    return { ok: false, plans: [], error: 'Ese pedido todavía no se puede surtir (debe estar pagado).' }
  }
  const plans = planSurtido(order, getSnapshotLots(), mapaEnCustodia())
  if (!canFulfill(plans)) return { ok: false, plans, error: 'No hay existencia disponible suficiente para surtir este pedido (revisa si hay producto en custodia).' }

  const itemLot: Record<string, string | null> = {}
  plans.forEach((p) => { itemLot[p.item.id] = p.allocations[0]?.lot.id ?? null })

  if (hasSupabase) {
    const allocations = plans.flatMap((p) => p.allocations.map((a) => ({ order_item_id: p.item.id, lot_id: a.lot.id, qty: a.qty })))
    const r = await runW1Command('surtir_pedido', { p_op_id: opId, p_order: order.id, p_allocations: allocations }, opId)
    if (!r.ok) { reloadInventory(); reloadOrders(); void reloadCustody(); return { ok: false, plans, error: r.error, ambiguous: r.ambiguous } }
    // Confirmado por el servidor: aviso/auditoría locales y recarga de la verdad.
    markPacked(order.id, itemLot, true)
    reloadInventory(); reloadOrders(); void reloadCustody()
    return { ok: true, plans }
  }

  // Modo demo (sin backend): descuento local síncrono.
  const allocations = plans.flatMap((p) => p.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty })))
  consume(allocations, order.external_ref ?? order.id, 'surtido', true)
  markPacked(order.id, itemLot, true)
  return { ok: true, plans }
}

// Lógica de surtido FEFO (first-expired, first-out).
// planSurtido: función PURA que sugiere lotes por caducidad ascendente.
// surtirPedido: confirma el surtido — descuenta lotes (+movimientos) y marca el
// pedido como Empacado. Conecta lotsStore + ordersStore.
import type { Lot, OrderItem } from '../types'
import { getSnapshotLots, consume } from '../store/lotsStore'
import { markPacked, type OrderWithItems } from '../store/ordersStore'

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

// Confirma el surtido FEFO del pedido.
export function surtirPedido(order: OrderWithItems): { ok: boolean; plans: ItemPlan[] } {
  const plans = planSurtido(order, getSnapshotLots())
  if (!canFulfill(plans)) return { ok: false, plans }

  const allocations = plans.flatMap((p) => p.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty })))
  consume(allocations, order.external_ref ?? order.id)

  const itemLot: Record<string, string | null> = {}
  plans.forEach((p) => {
    itemLot[p.item.id] = p.allocations[0]?.lot.id ?? null
  })
  markPacked(order.id, itemLot)

  return { ok: true, plans }
}

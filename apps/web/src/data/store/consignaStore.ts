// CONSIGNACIÓN POR VENDEDOR (saldo permanente). Almacén ASIGNA producto a un
// vendedor (descuenta del central por FEFO, con trazabilidad); el vendedor lo
// trae consigo y VENDE DIRECTO a sus clientes descontando de SU saldo. No hay
// cierre diario: regresa lo no vendido cuando quiera. Modelo: equipo chico que
// confía en sus vendedores. Mock; con Supabase = tabla consignment_stock.
import { getSnapshotLots, getSnapshotMovements, consume, adjust } from './lotsStore'
import { allocateFEFO } from '../ops/surtir'
import { createPosOrder, type OrderWithItems } from './ordersStore'
import { logAudit } from './auditStore'
import { notify } from './notificationsStore'

export interface ConsignaItem { product_id: string; assigned: number; sold: number }
export const remaining = (it: ConsignaItem): number => it.assigned - it.sold

let byVendor: Record<string, ConsignaItem[]> = {}
const listeners = new Set<() => void>()
let snapshot: Record<string, ConsignaItem[]> = {}

function emit() { snapshot = { ...byVendor }; listeners.forEach((l) => l()) }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }
export const getSnapshot = (): Record<string, ConsignaItem[]> => snapshot

export const balanceOf = (vendor: string): ConsignaItem[] => snapshot[vendor] ?? []
export const remainingFor = (vendor: string, productId: string): number => {
  const it = (byVendor[vendor] ?? []).find((x) => x.product_id === productId)
  return it ? remaining(it) : 0
}
const ref = (vendor: string) => `CONSIGNA-${vendor}`

// Almacén asigna producto al vendedor: descuenta del central (FEFO) y lo suma a su saldo.
export function assignToVendor(vendor: string, productId: string, qty: number): { ok: boolean; missing?: number } {
  if (!vendor || qty <= 0) return { ok: false }
  const plan = allocateFEFO(productId, qty, getSnapshotLots())
  if (plan.shortfall > 0) return { ok: false, missing: plan.shortfall }
  consume(plan.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty })), ref(vendor), 'consigna')
  const list = byVendor[vendor] ? [...byVendor[vendor]] : []
  const i = list.findIndex((x) => x.product_id === productId)
  if (i >= 0) list[i] = { ...list[i], assigned: list[i].assigned + qty }
  else list.push({ product_id: productId, assigned: qty, sold: 0 })
  byVendor = { ...byVendor, [vendor]: list }
  emit()
  notify({ text: `Recibiste ${qty} u en consignación`, roles: ['pos'], screen: 'consigna' })
  logAudit({ actor: 'Almacén', action: 'Consignación asignada', resource: vendor, detail: `producto ${productId} ×${qty}` })
  return { ok: true }
}

// Venta directa del vendedor: descuenta de SU saldo y registra la venta (POS) a
// nombre del cliente. NO vuelve a tocar el central (ya salió al asignar).
export function sellFromConsigna(vendor: string, lines: { product_id: string; qty: number; unit_price: number }[], total: number, paymentMethod: string, doctorId: string): OrderWithItems | null {
  if (!vendor || lines.length === 0) return null
  const ok = lines.every((l) => remainingFor(vendor, l.product_id) >= l.qty)
  if (!ok) return null
  const order = createPosOrder({
    lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, lot_id: null })),
    total, payment_method: paymentMethod, doctor_id: doctorId, channel: 'consigna', seller: vendor,
  })
  byVendor = {
    ...byVendor,
    [vendor]: (byVendor[vendor] ?? []).map((it) => {
      const s = lines.find((l) => l.product_id === it.product_id)?.qty ?? 0
      return s ? { ...it, sold: it.sold + s } : it
    }),
  }
  emit()
  logAudit({ actor: vendor, action: 'Venta directa (consignación)', resource: order.external_ref ?? '', detail: `cliente ${doctorId}` })
  return order
}

// Regresar al almacén lo no vendido (cuando el vendedor quiera): vuelve a SUS lotes.
export function returnToWarehouse(vendor: string, productId: string, qty: number) {
  if (qty <= 0) return
  const lots = getSnapshotLots()
  const productOfLot = (lotId: string) => lots.find((l) => l.id === lotId)?.product_id
  const assigns = getSnapshotMovements().filter((m) => m.reference === ref(vendor) && m.reason === 'consigna' && m.change < 0 && productOfLot(m.lot_id) === productId)
  let left = qty
  for (const m of assigns) {
    if (left <= 0) break
    const give = Math.min(left, -m.change)
    adjust(m.lot_id, give, 'consigna-regreso', ref(vendor))
    left -= give
  }
  byVendor = {
    ...byVendor,
    [vendor]: (byVendor[vendor] ?? []).map((it) => (it.product_id === productId ? { ...it, assigned: Math.max(it.sold, it.assigned - qty) } : it)).filter((it) => it.assigned > 0 || it.sold > 0),
  }
  emit()
  logAudit({ actor: 'Almacén', action: 'Consignación devuelta', resource: vendor, detail: `producto ${productId} ×${qty}` })
}

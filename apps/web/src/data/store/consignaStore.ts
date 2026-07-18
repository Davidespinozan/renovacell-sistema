// CONSIGNACIÓN POR VENDEDOR (saldo permanente). Almacén ASIGNA producto a un
// vendedor (descuenta del central por FEFO); el vendedor VENDE DIRECTO descontando
// de SU saldo; regresa lo no vendido cuando quiera. Con backend persiste en
// `consignment_stock` (vendor = email; RLS por email del JWT); el descuento/
// reingreso de lotes ya escribe write-through en lotsStore. El hook no cambia.
import { getSnapshotLots, getSnapshotMovements, consume, adjust } from './lotsStore'
import { allocateFEFO } from '../ops/surtir'
import { createPosOrder, type OrderWithItems } from './ordersStore'
import { logAudit } from './auditStore'
import { notify } from './notificationsStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import type { Json } from '../database.types'

// `lots` = desglose por lote del saldo NO vendido, en orden FEFO de asignación.
// Sostiene la trazabilidad lote→cliente cuando el vendedor vende en campo.
export interface ConsignaLot { lot_id: string; qty: number }
export interface ConsignaItem { product_id: string; assigned: number; sold: number; lots?: ConsignaLot[] }
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

// ---- Hidratación desde Supabase (RLS acota por email del vendedor) ----
async function hydrate() {
  if (!hasSupabase) return
  const { data, error } = await supabase.from('consignment_stock').select('vendor, product_id, assigned, sold, lots')
  if (error) { console.warn('[consigna] hydrate', error.message); return }
  const map: Record<string, ConsignaItem[]> = {}
  ;(data ?? []).forEach((r) => {
    const v = r.vendor as string
    ;(map[v] ??= []).push({ product_id: r.product_id as string, assigned: r.assigned, sold: r.sold, lots: (r.lots as ConsignaLot[] | null) ?? [] })
  })
  byVendor = map
  emit()
}
if (hasSupabase) {
  hydrate()
  supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'SIGNED_OUT' || ev === 'TOKEN_REFRESHED') hydrate() })
} else {
  // Semilla de DEMO (sin backend): consignación de los vendedores para mostrar saldos,
  // la alerta de saldo bajo y "pedir reabasto". Es estado de demo (no descuenta lotes).
  byVendor = {
    'ventas1@renovacell.mx': [
      { product_id: 'p-mgp-90', assigned: 20, sold: 18 }, // quedan 2 → saldo bajo
      { product_id: 'p-ab-50', assigned: 10, sold: 3 },   // quedan 7
      { product_id: 'p-pl-12', assigned: 8, sold: 5 },    // quedan 3 → saldo bajo
    ],
    'ventas2@renovacell.mx': [
      { product_id: 'p-gs-114', assigned: 12, sold: 4 },  // quedan 8
    ],
  }
  emit()
}

// Persiste (upsert/borra) el renglón del vendedor para un producto tras mutar.
function persist(vendor: string, productId: string) {
  if (!hasSupabase) return
  const it = (byVendor[vendor] ?? []).find((x) => x.product_id === productId)
  if (!it || (it.assigned <= 0 && it.sold <= 0)) {
    supabase.from('consignment_stock').delete().eq('vendor', vendor).eq('product_id', productId).then(({ error }) => { if (error) console.warn('[consigna] delete', error.message) })
  } else {
    supabase.from('consignment_stock').upsert({ vendor, product_id: productId, assigned: it.assigned, sold: it.sold, lots: (it.lots ?? []) as unknown as Json, updated_at: new Date().toISOString() }, { onConflict: 'vendor,product_id' }).then(({ error }) => { if (error) console.warn('[consigna] upsert', error.message) })
  }
}

// Almacén asigna al vendedor: descuenta del central (FEFO, write-through) y suma a su saldo.
export function assignToVendor(vendor: string, productId: string, qty: number): { ok: boolean; missing?: number } {
  if (!vendor || qty <= 0) return { ok: false }
  const plan = allocateFEFO(productId, qty, getSnapshotLots())
  if (plan.shortfall > 0) return { ok: false, missing: plan.shortfall }
  consume(plan.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty })), ref(vendor), 'consigna')
  const allocated: ConsignaLot[] = plan.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty }))
  const list = byVendor[vendor] ? [...byVendor[vendor]] : []
  const i = list.findIndex((x) => x.product_id === productId)
  if (i >= 0) list[i] = { ...list[i], assigned: list[i].assigned + qty, lots: [...(list[i].lots ?? []), ...allocated] }
  else list.push({ product_id: productId, assigned: qty, sold: 0, lots: allocated })
  byVendor = { ...byVendor, [vendor]: list }
  emit()
  persist(vendor, productId)
  notify({ text: `Recibiste ${qty} u en consignación`, roles: ['pos'], screen: 'consigna' })
  logAudit({ actor: 'Almacén', action: 'Consignación asignada', resource: vendor, detail: `producto ${productId} ×${qty}` })
  return { ok: true }
}

// Venta directa del vendedor: descuenta de SU saldo y registra la venta (POS).
export function sellFromConsigna(vendor: string, lines: { product_id: string; qty: number; unit_price: number }[], total: number, paymentMethod: string, doctorId: string): OrderWithItems | null {
  if (!vendor || lines.length === 0) return null
  const ok = lines.every((l) => remainingFor(vendor, l.product_id) >= l.qty)
  if (!ok) return null
  // TRAZABILIDAD: atribuye la venta a los lotes que el vendedor trae (orden FEFO de
  // asignación). NO descuenta stock —eso ya ocurrió al asignar—: aquí solo se registra
  // QUÉ LOTE recibió el cliente. Si una venta abarca dos lotes, se parte en dos
  // renglones para que el rastro sea exacto.
  const restByProduct: Record<string, ConsignaLot[]> = {}
  const posLines: { product_id: string; qty: number; unit_price: number; lot_id: string | null }[] = []
  lines.forEach((l) => {
    const pool = [...((byVendor[vendor] ?? []).find((x) => x.product_id === l.product_id)?.lots ?? [])]
    let pending = l.qty
    while (pending > 0 && pool.length > 0) {
      const head = pool[0]
      const take = Math.min(head.qty, pending)
      posLines.push({ product_id: l.product_id, qty: take, unit_price: l.unit_price, lot_id: head.lot_id })
      pending -= take
      if (take >= head.qty) pool.shift()
      else pool[0] = { ...head, qty: head.qty - take }
    }
    // Saldo heredado sin desglose de lote (asignado antes de esta mejora): se registra
    // sin lote en vez de perder la venta.
    if (pending > 0) posLines.push({ product_id: l.product_id, qty: pending, unit_price: l.unit_price, lot_id: null })
    restByProduct[l.product_id] = pool
  })
  const order = createPosOrder({
    lines: posLines,
    total, payment_method: paymentMethod, doctor_id: doctorId, channel: 'consigna', seller: vendor,
  })
  byVendor = {
    ...byVendor,
    [vendor]: (byVendor[vendor] ?? []).map((it) => {
      const s = lines.find((l) => l.product_id === it.product_id)?.qty ?? 0
      return s ? { ...it, sold: it.sold + s, lots: restByProduct[it.product_id] ?? it.lots } : it
    }),
  }
  emit()
  lines.forEach((l) => persist(vendor, l.product_id))
  logAudit({ actor: vendor, action: 'Venta directa (consignación)', resource: order.external_ref ?? '', detail: `cliente ${doctorId}` })
  return order
}

// Umbral de "saldo bajo" en consignación: a esta cantidad o menos, conviene reabastecer.
export const LOW_CONSIGNA = 5

// El vendedor pide a Almacén que le reabastezca un producto de su consignación. NO
// mueve inventario: notifica a Almacén/Dirección (que asignan desde su pantalla de
// consignación) y lo deja en la bitácora. La asignación real la hace Almacén.
export function requestRestock(vendor: string, productId: string, productName: string): void {
  notify({ text: `${vendor} pide reabasto de ${productName} (consignación)`, roles: ['warehouse', 'admin'], screen: 'consigna_alm' })
  logAudit({ actor: vendor, action: 'Reabasto de consignación solicitado', resource: productName, detail: `producto ${productId}` })
}

// Regresar al almacén lo no vendido: vuelve a SUS lotes (adjust write-through).
export function returnToWarehouse(vendor: string, productId: string, qty: number) {
  if (qty <= 0) return
  // Tope: solo se puede devolver lo que sigue EN PODER del vendedor (asignado −
  // vendido). Sin esto, devolver de más reingresaba unidades ya vendidas → stock
  // fantasma en el almacén.
  const item = (byVendor[vendor] ?? []).find((it) => it.product_id === productId)
  const remaining = item ? Math.max(0, item.assigned - item.sold) : 0
  qty = Math.min(qty, remaining)
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
  persist(vendor, productId)
  logAudit({ actor: 'Almacén', action: 'Consignación devuelta', resource: vendor, detail: `producto ${productId} ×${qty}` })
}

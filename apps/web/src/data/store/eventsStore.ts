// EVENTOS (POS / Ventas). En expos/congresos no llevan todo el catálogo: arman un
// inventario para el evento (se DESCUENTA del stock general al asignar, vía FEFO),
// venden de ese inventario en el stand, y al cerrar el sobrante REGRESA al almacén.
// Reutiliza la trazabilidad por lote (consume/addEntry). Mock; Supabase = tablas.
import { getSnapshotLots, getSnapshotMovements, consume, addEntry, adjust } from './lotsStore'
import { allocateFEFO } from '../ops/surtir'
import { createPosOrder, type OrderWithItems } from './ordersStore'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'

export interface EventItem { product_id: string; assigned: number; sold: number }
export interface SalesEvent {
  id: string
  name: string
  venue: string
  date: string
  status: 'activo' | 'cerrado'
  items: EventItem[]
  members: string[] // correos de los asignados al evento; solo ellos lo ven
  created_at: string
}

let events: SalesEvent[] = []
let seq = 0
const listeners = new Set<() => void>()
let snapshot: SalesEvent[] = []

function emit() { snapshot = [...events]; listeners.forEach((l) => l()) }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }
export const getSnapshot = (): SalesEvent[] => snapshot

export const remaining = (it: EventItem): number => it.assigned - it.sold

export function createEvent(input: { name: string; venue: string; date: string; members: string[] }): SalesEvent {
  seq += 1
  const e: SalesEvent = { id: `evt-${seq}`, name: input.name, venue: input.venue, date: input.date, status: 'activo', items: [], members: input.members, created_at: new Date().toISOString() }
  events = [e, ...events]
  emit()
  logAudit({ actor: 'Ventas', action: 'Evento creado', resource: input.name })
  return e
}

// Asigna inventario al evento: descuenta del stock general por FEFO.
export function assignStock(eventId: string, productId: string, qty: number): { ok: boolean; missing?: number } {
  const ev = events.find((e) => e.id === eventId)
  if (!ev || qty <= 0) return { ok: false }
  const plan = allocateFEFO(productId, qty, getSnapshotLots())
  if (plan.shortfall > 0) return { ok: false, missing: plan.shortfall }
  consume(plan.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty })), ev.name, 'evento')
  events = events.map((e) => {
    if (e.id !== eventId) return e
    const items = [...e.items]
    const i = items.findIndex((x) => x.product_id === productId)
    if (i >= 0) items[i] = { ...items[i], assigned: items[i].assigned + qty }
    else items.push({ product_id: productId, assigned: qty, sold: 0 })
    return { ...e, items }
  })
  emit()
  logAudit({ actor: 'Almacén', action: 'Inventario asignado a evento', resource: ev.name, detail: `${qty} u` })
  return { ok: true }
}

// Venta en el evento: crea la orden POS (ingreso/REPORTE) y descuenta del evento.
// No vuelve a tocar el stock general (ya salió al asignar).
export function sellAtEvent(eventId: string, lines: { product_id: string; qty: number; unit_price: number }[], total: number, paymentMethod: string, seller: string | null = null): OrderWithItems | null {
  const ev = events.find((e) => e.id === eventId)
  if (!ev || lines.length === 0) return null
  // No permitir sobreventa ni vender un producto que no está en el inventario del evento.
  const sellable = lines.every((l) => {
    const it = ev.items.find((x) => x.product_id === l.product_id)
    return it != null && remaining(it) >= l.qty
  })
  if (!sellable) return null
  const order = createPosOrder({
    lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, lot_id: null })),
    total,
    payment_method: paymentMethod,
    event_id: eventId,
    seller,
  })
  events = events.map((e) => {
    if (e.id !== eventId) return e
    const items = e.items.map((it) => {
      const sold = lines.find((l) => l.product_id === it.product_id)?.qty ?? 0
      return sold ? { ...it, sold: it.sold + sold } : it
    })
    return { ...e, items }
  })
  emit()
  return order
}

// Cierra el evento: el sobrante REGRESA a SUS lotes de origen (conserva caducidad
// y trazabilidad). Idempotente. Fallback a entrada genérica solo si no se puede
// mapear el lote original.
export function closeEvent(eventId: string) {
  const ev = events.find((e) => e.id === eventId)
  if (!ev || ev.status === 'cerrado') return // idempotente: no reingresar dos veces
  const lots = getSnapshotLots()
  const productOfLot = (lotId: string) => lots.find((l) => l.id === lotId)?.product_id
  // Asignaciones de este evento por lote (salidas con reason 'evento').
  const assigns = getSnapshotMovements().filter((m) => m.reference === ev.name && m.reason === 'evento' && m.change < 0)
  ev.items.forEach((it) => {
    let left = remaining(it)
    if (left <= 0) return
    const lotsOfProduct = assigns.filter((m) => productOfLot(m.lot_id) === it.product_id)
    for (const m of lotsOfProduct) {
      if (left <= 0) break
      const give = Math.min(left, -m.change)
      adjust(m.lot_id, give, 'evento-regreso', ev.name)
      left -= give
    }
    if (left > 0) addEntry({ product_id: it.product_id, lot_code: `EVENTO-${ev.id}`, expiry_date: null, quantity: left, location: 'Almacén (regreso evento)' })
  })
  events = events.map((e) => (e.id === eventId ? { ...e, status: 'cerrado' } : e))
  emit()
  logAudit({ actor: 'Ventas', action: 'Evento cerrado', resource: ev.name })
  notify({ text: `Evento cerrado: ${ev.name}`, roles: ['admin'], screen: 'av_ventas' })
}

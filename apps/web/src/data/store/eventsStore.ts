// EVENTOS (POS / Ventas). En expos/congresos arman un inventario para el evento
// (se DESCUENTA del stock general al asignar, FEFO), venden en el stand, y al
// cerrar el sobrante REGRESA al almacén. Con backend persiste en la tabla `events`
// (items y members embebidos; RLS por email del miembro). El descuento/reingreso
// de lotes ya escribe write-through en lotsStore. El hook useEvents no cambia.
import { getSnapshotLots, getSnapshotMovements, consume, addEntry, adjust } from './lotsStore'
import { allocateFEFO } from '../ops/surtir'
import { createPosOrder, type OrderWithItems } from './ordersStore'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import type { Json } from '../database.types'

// `lots` = desglose por lote del stock del stand NO vendido (orden FEFO de asignación).
// Sostiene la trazabilidad lote→cliente en la venta del evento.
export interface EventLot { lot_id: string; qty: number }
export interface EventItem { product_id: string; assigned: number; sold: number; lots?: EventLot[] }
export interface SalesEvent {
  id: string
  name: string
  venue: string
  date: string
  status: 'activo' | 'cerrado'
  items: EventItem[]
  members: string[]
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

const isUuid = (s: string | null | undefined): boolean => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

// ---- Hidratación (RLS acota a admin + miembros del evento) ----
async function hydrate() {
  if (!hasSupabase) return
  const { data, error } = await supabase.from('events').select('id, name, venue, date, status, members, items, created_at').order('created_at', { ascending: false })
  if (error) { console.warn('[events] hydrate', error.message); return }
  events = (data ?? []).map((e) => ({
    id: e.id, name: e.name, venue: e.venue ?? '', date: e.date ?? '', status: (e.status as SalesEvent['status']) ?? 'activo',
    items: (e.items ?? []) as unknown as EventItem[], members: (e.members ?? []) as unknown as string[], created_at: e.created_at ?? new Date().toISOString(),
  }))
  emit()
}
if (hasSupabase) {
  hydrate()
  supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'SIGNED_OUT' || ev === 'TOKEN_REFRESHED') hydrate() })
}

function persistEvent(id: string) {
  if (!hasSupabase || !isUuid(id)) return
  const e = events.find((x) => x.id === id)
  if (!e) return
  supabase.from('events').update({
    name: e.name, venue: e.venue, date: e.date, status: e.status,
    members: e.members as unknown as Json, items: e.items as unknown as Json,
  }).eq('id', id).then(({ error }) => { if (error) console.warn('[events] persist', error.message) })
}

export function createEvent(input: { name: string; venue: string; date: string; members: string[] }): SalesEvent {
  seq += 1
  const id = hasSupabase ? (globalThis.crypto?.randomUUID?.() ?? `evt-${seq}`) : `evt-${seq}`
  const e: SalesEvent = { id, name: input.name, venue: input.venue, date: input.date, status: 'activo', items: [], members: input.members, created_at: new Date().toISOString() }
  events = [e, ...events]
  emit()
  logAudit({ actor: 'Ventas', action: 'Evento creado', resource: input.name })
  if (hasSupabase) {
    supabase.from('events').insert({ id, name: input.name, venue: input.venue, date: input.date, status: 'activo', members: input.members as unknown as Json, items: [] as unknown as Json, created_by: currentUserId() })
      .then(({ error }) => { if (error) console.warn('[events] insert', error.message); hydrate() })
  }
  return e
}

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
    const alloc: EventLot[] = plan.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty }))
    if (i >= 0) items[i] = { ...items[i], assigned: items[i].assigned + qty, lots: [...(items[i].lots ?? []), ...alloc] }
    else items.push({ product_id: productId, assigned: qty, sold: 0, lots: alloc })
    return { ...e, items }
  })
  emit()
  persistEvent(eventId)
  logAudit({ actor: 'Almacén', action: 'Inventario asignado a evento', resource: ev.name, detail: `${qty} u` })
  return { ok: true }
}

export function sellAtEvent(eventId: string, lines: { product_id: string; qty: number; unit_price: number }[], total: number, paymentMethod: string, seller: string | null = null): OrderWithItems | null {
  const ev = events.find((e) => e.id === eventId)
  if (!ev || lines.length === 0) return null
  const sellable = lines.every((l) => {
    const it = ev.items.find((x) => x.product_id === l.product_id)
    return it != null && remaining(it) >= l.qty
  })
  if (!sellable) return null
  // TRAZABILIDAD: el stock ya se descontó al asignar al stand; aquí solo se registra
  // QUÉ LOTE recibió el cliente. Si la venta abarca dos lotes, se parte en dos renglones.
  const restByProduct: Record<string, EventLot[]> = {}
  const posLines: { product_id: string; qty: number; unit_price: number; lot_id: string | null }[] = []
  lines.forEach((l) => {
    const pool = [...(ev.items.find((x) => x.product_id === l.product_id)?.lots ?? [])]
    let pending = l.qty
    while (pending > 0 && pool.length > 0) {
      const head = pool[0]
      const take = Math.min(head.qty, pending)
      posLines.push({ product_id: l.product_id, qty: take, unit_price: l.unit_price, lot_id: head.lot_id })
      pending -= take
      if (take >= head.qty) pool.shift()
      else pool[0] = { ...head, qty: head.qty - take }
    }
    if (pending > 0) posLines.push({ product_id: l.product_id, qty: pending, unit_price: l.unit_price, lot_id: null })
    restByProduct[l.product_id] = pool
  })
  const order = createPosOrder({
    lines: posLines,
    total, payment_method: paymentMethod, event_id: eventId, seller,
  })
  events = events.map((e) => {
    if (e.id !== eventId) return e
    const items = e.items.map((it) => {
      const sold = lines.find((l) => l.product_id === it.product_id)?.qty ?? 0
      // Descuenta también del desglose por lote (lo que queda en el stand).
      return sold ? { ...it, sold: it.sold + sold, lots: restByProduct[it.product_id] ?? it.lots } : it
    })
    return { ...e, items }
  })
  emit()
  // ATÓMICO: en vez de reescribir el items completo (last-write-wins → lost update
  // con varios vendedores), la RPC event_sell incrementa `sold` con FOR UPDATE y tope.
  if (hasSupabase && isUuid(eventId)) {
    supabase.rpc('event_sell', { p_event: eventId, p_sales: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })) })
      .then(({ data, error }) => { if (error || data === false) console.warn('[events] venta concurrente rechazada', error?.message); hydrate() })
  }
  return order
}

// Regresa a SUS lotes de origen el sobrante (asignado − vendido) de un evento.
function returnLeftover(ev: SalesEvent) {
  const lots = getSnapshotLots()
  const productOfLot = (lotId: string) => lots.find((l) => l.id === lotId)?.product_id
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
}

export function updateEvent(eventId: string, patch: { name?: string; venue?: string; date?: string; members?: string[] }) {
  const before = events.find((e) => e.id === eventId)
  events = events.map((e) => (e.id === eventId ? { ...e, ...patch } : e))
  emit()
  persistEvent(eventId)
  if (before) logAudit({ actor: 'Ventas', action: 'Evento editado', resource: patch.name ?? before.name })
}

export function deleteEvent(eventId: string) {
  const ev = events.find((e) => e.id === eventId)
  if (!ev) return
  if (ev.status === 'activo') returnLeftover(ev)
  events = events.filter((e) => e.id !== eventId)
  emit()
  logAudit({ actor: 'Ventas', action: 'Evento eliminado', resource: ev.name })
  if (hasSupabase && isUuid(eventId)) supabase.from('events').delete().eq('id', eventId).then(({ error }) => { if (error) console.warn('[events] delete', error.message); hydrate() })
}

export function closeEvent(eventId: string) {
  const ev = events.find((e) => e.id === eventId)
  if (!ev || ev.status === 'cerrado') return
  returnLeftover(ev)
  events = events.map((e) => (e.id === eventId ? { ...e, status: 'cerrado' } : e))
  emit()
  persistEvent(eventId)
  logAudit({ actor: 'Ventas', action: 'Evento cerrado', resource: ev.name })
  notify({ text: `Evento cerrado: ${ev.name}`, roles: ['admin'], screen: 'av_ventas' })
}

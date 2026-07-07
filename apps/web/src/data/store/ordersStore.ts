// Store de pedidos. Con backend (hasSupabase) hidrata de `orders`+`order_items`
// (el RLS ya limita: el doctor ve SOLO los suyos, el staff TODOS) y las
// mutaciones escriben write-through: el doctor crea/paga/cancela SU pedido; el
// pago pasa por la función segura pay_order (como el webhook de Stripe); el staff
// avanza el estado. Sin backend, opera sobre las semillas mock. La API no cambia.
import type { Order, OrderItem } from '../types'
import { DOCTOR_ID, MOCK_ORDERS, MOCK_ORDER_ITEMS } from '../mock/orders'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { restockByReference } from './lotsStore'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import type { Json } from '../database.types'

const folioOf = (id: string): string => orders.find((o) => o.id === id)?.external_ref ?? id
const isUuid = (s: string | null | undefined): boolean => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)
const uuid = (): string => (globalThis.crypto?.randomUUID?.() ?? `o-${Math.random().toString(16).slice(2)}`)

export interface OrderWithItems extends Order { items: OrderItem[] }
export interface NewOrderLine { product_id: string; qty: number; unit_price: number | null }

let orders: Order[] = hasSupabase ? [] : [...MOCK_ORDERS]
let items: OrderItem[] = hasSupabase ? [] : [...MOCK_ORDER_ITEMS]

const listeners = new Set<() => void>()

function withItems(list: Order[]): OrderWithItems[] {
  return list
    .map((o) => ({ ...o, items: items.filter((it) => it.order_id === o.id) }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

// Con backend, el set ya viene acotado por RLS (doctor=suyos / staff=todos), así
// que doctor y "todos" parten del mismo cache; sin backend se filtra por DOCTOR_ID.
let snapshotDoctor: OrderWithItems[] = []
let snapshotAll: OrderWithItems[] = []
function recompute() {
  snapshotAll = withItems(orders)
  snapshotDoctor = hasSupabase ? snapshotAll : withItems(orders.filter((o) => o.doctor_id === DOCTOR_ID))
}
recompute()

function emit() { recompute(); listeners.forEach((l) => l()) }

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): OrderWithItems[] => snapshotDoctor
export const getSnapshotAll = (): OrderWithItems[] => snapshotAll

// ¿Terminó la primera hidratación con la sesión actual? Evita empty-states falsos
// ("No tienes pedidos activos") mientras aún carga desde Supabase.
let hydrated = !hasSupabase
export const ready = (): boolean => hydrated

// ---- Hidratación desde Supabase (RLS acota el resultado por rol) ----
async function hydrate() {
  if (!hasSupabase) return
  const { data, error } = await supabase
    .from('orders')
    .select('id, external_ref, doctor_id, total, currency, status, payment_method, payment_ref, payment_status, stripe_payment_id, invoice_requested, invoice_meta, shipping_meta, created_at, order_items(id, order_id, product_id, lot_id, qty, unit_price, created_at)')
    .order('created_at', { ascending: false })
  if (error) { console.warn('[orders] hydrate', error.message); hydrated = true; emit(); return }
  const rows = data ?? []
  orders = rows.map((r) => {
    const { order_items: _oi, ...o } = r as Record<string, unknown>
    return o as unknown as Order
  })
  items = rows.flatMap((r) => ((r as { order_items?: OrderItem[] }).order_items ?? []))
  hydrated = true
  emit()
}
if (hasSupabase) {
  hydrate()
  supabase.auth.onAuthStateChange((ev) => {
    // En login / cambio de sesión volvemos a "no hidratado" para no mostrar un
    // vacío falso; el refresco de token recarga en silencio.
    if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'SIGNED_OUT') { hydrated = false; hydrate() }
    else if (ev === 'TOKEN_REFRESHED') hydrate()
  })
}

export function createOrder(input: {
  lines: NewOrderLine[]
  total: number
  invoice_requested: boolean
  doctor_id?: string
  placedBy?: string
}): OrderWithItems {
  const id = hasSupabase ? uuid() : `o-${Math.floor(Math.random() * 1e6)}`
  const folio = `S${Date.now().toString().slice(-6)}`
  const now = new Date().toISOString()
  const doctorId = input.doctor_id ?? (hasSupabase ? currentUserId() : DOCTOR_ID)

  const order: Order = {
    id, external_ref: folio, doctor_id: doctorId, total: input.total, currency: 'MXN',
    status: 'pending_payment', payment_method: 'contra_pedido', payment_ref: null,
    payment_status: 'pending', stripe_payment_id: null, invoice_requested: input.invoice_requested,
    invoice_meta: null, shipping_meta: input.placedBy ? { placed_by: input.placedBy } : null, created_at: now,
  }
  const newItems: OrderItem[] = input.lines.map((l, i) => ({
    id: `${id}-${i}`, order_id: id, product_id: l.product_id, lot_id: null,
    qty: l.qty, unit_price: l.unit_price, created_at: now,
  }))

  orders = [order, ...orders]
  items = [...items, ...newItems]
  emit()
  notify({ text: `Nuevo pedido ${folio} · contra pedido`, roles: ['warehouse'], screen: 'surtido' })
  logAudit({ actor: input.placedBy ?? 'Portal del Doctor', action: 'Pedido creado', resource: folio })

  // Persistir solo si el doctor_id es un uuid real (pedido propio del doctor;
  // el "a nombre de" con id mock se conectará al cablear doctores).
  if (hasSupabase && isUuid(doctorId)) {
    (async () => {
      const oi = await supabase.from('orders').insert({
        id, external_ref: folio, doctor_id: doctorId, total: input.total, currency: 'MXN',
        status: 'pending_payment', payment_method: 'contra_pedido', payment_status: 'pending',
        invoice_requested: input.invoice_requested, shipping_meta: order.shipping_meta as unknown as Json,
      })
      if (oi.error) { console.warn('[orders] insert', oi.error.message); return }
      await supabase.from('order_items').insert(input.lines.map((l) => ({
        order_id: id, product_id: l.product_id, qty: l.qty, unit_price: l.unit_price,
      })))
      hydrate()
    })()
  }
  return { ...order, items: newItems }
}

const CANCELABLE = ['draft', 'pending_payment', 'paid', 'picking', 'packed']
export const isCancelable = (status: string | null): boolean => CANCELABLE.includes(status ?? '')
export function cancelOrder(orderId: string, actor = 'Administración'): { ok: boolean } {
  const o = orders.find((x) => x.id === orderId)
  if (!o || !isCancelable(o.status)) return { ok: false }
  if (o.status === 'packed') restockByReference(o.external_ref ?? o.id)
  orders = orders.map((x) => (x.id === orderId ? { ...x, status: 'cancelled' } : x))
  emit()
  notify({ text: `Pedido ${o.external_ref ?? orderId} cancelado`, roles: ['admin'], screen: 'av_ventas' })
  logAudit({ actor, action: 'Pedido cancelado', resource: o.external_ref ?? orderId })
  if (hasSupabase && isUuid(orderId)) {
    supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId).then(({ error }) => { if (error) console.warn('[orders] cancel', error.message); hydrate() })
  }
  return { ok: true }
}

export interface PosOrderLine { product_id: string; qty: number; unit_price: number; lot_id: string | null }
export function createPosOrder(input: {
  lines: PosOrderLine[]
  total: number
  payment_method: string
  event_id?: string | null
  seller?: string | null
  doctor_id?: string | null
  channel?: string
}): OrderWithItems {
  const id = hasSupabase ? uuid() : `pos-${Math.floor(Math.random() * 1e6)}`
  const folio = `POS-${Date.now().toString().slice(-6)}`
  const now = new Date().toISOString()
  const shipping_meta = { channel: input.channel ?? 'pos', event_id: input.event_id ?? null, seller: input.seller ?? null }

  const order: Order = {
    id, external_ref: folio, doctor_id: input.doctor_id ?? null, total: input.total, currency: 'MXN',
    status: 'delivered', payment_method: input.payment_method, payment_ref: null,
    payment_status: 'paid', stripe_payment_id: null, invoice_requested: false,
    invoice_meta: null, shipping_meta, created_at: now,
  }
  const newItems: OrderItem[] = input.lines.map((l, i) => ({
    id: `${id}-${i}`, order_id: id, product_id: l.product_id, lot_id: l.lot_id,
    qty: l.qty, unit_price: l.unit_price, created_at: now,
  }))

  orders = [order, ...orders]
  items = [...items, ...newItems]
  emit()
  notify({ text: `Venta POS ${folio} cobrada`, roles: ['admin'], screen: 'av_ventas' })
  logAudit({ actor: 'Punto de Venta', action: 'Venta POS', resource: folio, detail: input.payment_method })

  if (hasSupabase) {
    (async () => {
      const oi = await supabase.from('orders').insert({
        id, external_ref: folio, doctor_id: isUuid(input.doctor_id) ? input.doctor_id : null, total: input.total,
        currency: 'MXN', status: 'delivered', payment_method: input.payment_method, payment_status: 'paid',
        invoice_requested: false, shipping_meta: shipping_meta as unknown as Json,
      })
      if (oi.error) { console.warn('[orders] pos insert', oi.error.message); return }
      await supabase.from('order_items').insert(input.lines.map((l) => ({
        order_id: id, product_id: l.product_id, lot_id: isUuid(l.lot_id) ? l.lot_id : null, qty: l.qty, unit_price: l.unit_price,
      })))
      hydrate()
    })()
  }
  return { ...order, items: newItems }
}

export function markPacked(orderId: string, itemLot: Record<string, string | null>) {
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: 'packed' } : o))
  items = items.map((it) => (it.order_id === orderId && itemLot[it.id] !== undefined ? { ...it, lot_id: itemLot[it.id] } : it))
  emit()
  notify({ text: `Pedido ${folioOf(orderId)} surtido · por empacar`, roles: ['warehouse'], screen: 'cola' })
  logAudit({ actor: 'Almacén', action: 'Surtido (FEFO)', resource: folioOf(orderId) })
  if (hasSupabase && isUuid(orderId)) {
    (async () => {
      await supabase.from('orders').update({ status: 'packed' }).eq('id', orderId)
      for (const [itemId, lotId] of Object.entries(itemLot)) {
        if (isUuid(itemId)) await supabase.from('order_items').update({ lot_id: isUuid(lotId) ? lotId : null }).eq('id', itemId)
      }
      hydrate()
    })()
  }
}

export function markShipped(orderId: string, shipping_meta: Record<string, unknown>) {
  const merged = orders.find((o) => o.id === orderId)
  const nextMeta = { ...((merged?.shipping_meta as object | null) ?? {}), ...shipping_meta }
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: 'shipped', shipping_meta: nextMeta } : o))
  emit()
  notify({ text: `Pedido ${folioOf(orderId)} en camino`, roles: ['admin'], screen: 'seguimiento' })
  logAudit({ actor: 'Empaque', action: 'Envío asignado', resource: folioOf(orderId) })
  if (hasSupabase && isUuid(orderId)) {
    supabase.from('orders').update({ status: 'shipped', shipping_meta: nextMeta as unknown as Json }).eq('id', orderId).then(({ error }) => { if (error) console.warn('[orders] ship', error.message); hydrate() })
  }
}

export function markDelivered(orderId: string) {
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: 'delivered' } : o))
  emit()
  notify({ text: `Pedido ${folioOf(orderId)} entregado`, roles: ['admin'], screen: 'av_ventas' })
  logAudit({ actor: 'Chofer', action: 'Entrega confirmada', resource: folioOf(orderId) })
  if (hasSupabase && isUuid(orderId)) {
    supabase.from('orders').update({ status: 'delivered' }).eq('id', orderId).then(({ error }) => { if (error) console.warn('[orders] deliver', error.message); hydrate() })
  }
}

function fakeFiscalUuid(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hex = (n: number, len: number) => (n >>> 0).toString(16).toUpperCase().padStart(len, '0').slice(0, len)
  const a = hex(h, 8), b = hex(h * 7, 4), c = hex(h * 13, 4), d = hex(h * 17, 4), e = hex(h * 19, 8) + hex(h * 23, 4)
  return `${a}-${b}-${c}-${d}-${e}`
}
export function markInvoiced(orderId: string) {
  const now = new Date().toISOString()
  const meta = { status: 'emitida', uuid: fakeFiscalUuid(orderId), emitida_at: now }
  orders = orders.map((o) => (o.id === orderId ? { ...o, invoice_requested: true, invoice_meta: meta } : o))
  emit()
  notify({ text: `CFDI emitido · ${folioOf(orderId)}`, roles: ['admin'], screen: 'av_fin' })
  logAudit({ actor: 'Administración', action: 'CFDI emitido', resource: folioOf(orderId) })
  if (hasSupabase && isUuid(orderId)) {
    supabase.from('orders').update({ invoice_requested: true, invoice_meta: meta }).eq('id', orderId).then(({ error }) => { if (error) console.warn('[orders] invoice', error.message); hydrate() })
  }
}

export function markPaid(orderId: string) {
  orders = orders.map((o) => (o.id === orderId ? { ...o, payment_status: 'paid' } : o))
  emit()
  notify({ text: `Pago registrado · ${folioOf(orderId)}`, roles: ['admin'], screen: 'av_fin' })
  logAudit({ actor: 'Administración', action: 'Pago registrado', resource: folioOf(orderId) })
  if (hasSupabase && isUuid(orderId)) {
    supabase.rpc('pay_order', { p_order: orderId, p_method: 'registrado', p_ref: 'ADM' }).then(({ error }) => { if (error) console.warn('[orders] markPaid', error.message); hydrate() })
  }
}

// Cobro EN LÍNEA (Portal del Doctor). Pasa por la función segura pay_order (que
// valida dueño/rol), como hará el webhook de Stripe.
export function payOrder(orderId: string, payment: { method: string; ref: string; actor?: string }): { ok: boolean } {
  const o = orders.find((x) => x.id === orderId)
  if (!o || o.payment_status === 'paid') return { ok: false }
  orders = orders.map((x) =>
    x.id === orderId
      ? { ...x, payment_status: 'paid', payment_method: payment.method, payment_ref: payment.ref, status: x.status === 'pending_payment' ? 'paid' : x.status }
      : x,
  )
  emit()
  notify({ text: `Pago recibido · ${o.external_ref ?? orderId} · listo para surtir`, roles: ['warehouse'], screen: 'surtido' })
  notify({ text: `Pago recibido · ${o.external_ref ?? orderId}`, roles: ['admin'], screen: 'av_fin' })
  logAudit({ actor: payment.actor ?? 'Portal del Doctor', action: 'Pago en línea', resource: o.external_ref ?? orderId, detail: payment.method })
  if (hasSupabase && isUuid(orderId)) {
    supabase.rpc('pay_order', { p_order: orderId, p_method: payment.method, p_ref: payment.ref }).then(({ error }) => { if (error) console.warn('[orders] payOrder', error.message); hydrate() })
  }
  return { ok: true }
}

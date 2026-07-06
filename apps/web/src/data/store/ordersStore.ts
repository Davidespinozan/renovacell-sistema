// Store compartido de pedidos (mock). Un solo origen para que el ciclo conecte:
// el Portal crea el pedido y Almacén lo surte (cambia su estatus); ambos lo ven.
// Doctor ve SUS pedidos (getSnapshot); staff (almacén) ve TODOS (getSnapshotAll).
// Al migrar a Supabase: queries + RLS; los hooks mantienen su firma.
import type { Order, OrderItem } from '../types'
import { DOCTOR_ID, MOCK_ORDERS, MOCK_ORDER_ITEMS } from '../mock/orders'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { restockByReference } from './lotsStore'
import { hasSupabase } from '../../lib/supabase'

const folioOf = (id: string): string => orders.find((o) => o.id === id)?.external_ref ?? id

export interface OrderWithItems extends Order {
  items: OrderItem[]
}

export interface NewOrderLine {
  product_id: string
  qty: number
  unit_price: number | null // null = cotización
}

// Con backend, arranca VACÍO (los pedidos reales nacen del uso; sin semillas mock
// con ids viejos). Sin backend, usa las semillas de demostración.
let orders: Order[] = hasSupabase ? [] : [...MOCK_ORDERS]
let items: OrderItem[] = hasSupabase ? [] : [...MOCK_ORDER_ITEMS]
let folioSeq = 3800
let posSeq = 100

const listeners = new Set<() => void>()

function withItems(list: Order[]): OrderWithItems[] {
  return list
    .map((o) => ({ ...o, items: items.filter((it) => it.order_id === o.id) }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

let snapshotDoctor: OrderWithItems[] = withItems(orders.filter((o) => o.doctor_id === DOCTOR_ID))
let snapshotAll: OrderWithItems[] = withItems(orders)

function emit() {
  snapshotDoctor = withItems(orders.filter((o) => o.doctor_id === DOCTOR_ID))
  snapshotAll = withItems(orders)
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const getSnapshot = (): OrderWithItems[] => snapshotDoctor
export const getSnapshotAll = (): OrderWithItems[] => snapshotAll

export function createOrder(input: {
  lines: NewOrderLine[]
  total: number
  invoice_requested: boolean
  doctor_id?: string   // a nombre de qué doctor (default: el doctor en sesión)
  placedBy?: string    // quién lo levantó (vendedor/dirección); default: Portal del Doctor
}): OrderWithItems {
  folioSeq += 1
  const id = `o-${folioSeq}`
  const folio = `S${folioSeq}`
  const now = new Date().toISOString()
  const doctorId = input.doctor_id ?? DOCTOR_ID

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
  return { ...order, items: newItems }
}

// Cancelar pedido. Permitido hasta antes de enviarse. Si ya estaba surtido
// (packed), REINGRESA el inventario a sus lotes (trazabilidad: motivo 'cancelacion').
const CANCELABLE = ['draft', 'pending_payment', 'paid', 'picking', 'packed']
export const isCancelable = (status: string | null): boolean => CANCELABLE.includes(status ?? '')
export function cancelOrder(orderId: string, actor = 'Administración'): { ok: boolean } {
  const o = orders.find((x) => x.id === orderId)
  if (!o || !isCancelable(o.status)) return { ok: false }
  if (o.status === 'packed') {
    // Reingresa el inventario a sus lotes reales (respeta el split FEFO), desde
    // el ledger de salidas de este folio. No depende del precio del renglón.
    restockByReference(o.external_ref ?? o.id)
  }
  orders = orders.map((x) => (x.id === orderId ? { ...x, status: 'cancelled' } : x))
  emit()
  notify({ text: `Pedido ${o.external_ref ?? orderId} cancelado`, roles: ['admin'], screen: 'av_ventas' })
  logAudit({ actor, action: 'Pedido cancelado', resource: o.external_ref ?? orderId })
  return { ok: true }
}

// Punto de Venta: venta inmediata en persona. Pago cobrado al momento y
// producto entregado en el acto (sin doctor, sin envío). Origen POS.
export interface PosOrderLine {
  product_id: string
  qty: number
  unit_price: number
  lot_id: string | null
}
export function createPosOrder(input: {
  lines: PosOrderLine[]
  total: number
  payment_method: string // 'efectivo' | 'tarjeta'
  event_id?: string | null // venta de evento (null = caja mostrador)
  seller?: string | null   // correo del vendedor que cobró
  doctor_id?: string | null // cliente (venta directa de consignación)
  channel?: string          // 'pos' | 'evento' | 'consigna'
}): OrderWithItems {
  posSeq += 1
  const id = `pos-${posSeq}`
  const folio = `POS-${posSeq}`
  const now = new Date().toISOString()

  const order: Order = {
    id, external_ref: folio, doctor_id: input.doctor_id ?? null, total: input.total, currency: 'MXN',
    status: 'delivered', payment_method: input.payment_method, payment_ref: null,
    payment_status: 'paid', stripe_payment_id: null, invoice_requested: false,
    invoice_meta: null, shipping_meta: { channel: input.channel ?? 'pos', event_id: input.event_id ?? null, seller: input.seller ?? null }, created_at: now,
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
  return { ...order, items: newItems }
}

// Surtido: marca el pedido como Empacado y asigna el lote surtido a cada renglón.
// (El descuento de lotes y los movimientos viven en lotsStore; ver ops/surtir.ts.)
export function markPacked(orderId: string, itemLot: Record<string, string | null>) {
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: 'packed' } : o))
  items = items.map((it) =>
    it.order_id === orderId && itemLot[it.id] !== undefined ? { ...it, lot_id: itemLot[it.id] } : it,
  )
  emit()
  notify({ text: `Pedido ${folioOf(orderId)} surtido · por empacar`, roles: ['warehouse'], screen: 'cola' })
  logAudit({ actor: 'Almacén', action: 'Surtido (FEFO)', resource: folioOf(orderId) })
}

// Empaque: al asignar envío, el pedido pasa a En camino y guarda el resumen de envío.
export function markShipped(orderId: string, shipping_meta: Record<string, unknown>) {
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: 'shipped', shipping_meta: { ...(o.shipping_meta as object | null), ...shipping_meta } } : o))
  emit()
  notify({ text: `Pedido ${folioOf(orderId)} en camino`, roles: ['admin'], screen: 'seguimiento' })
  logAudit({ actor: 'Empaque', action: 'Envío asignado', resource: folioOf(orderId) })
}

// Seguimiento/Chofer: entrega confirmada -> cierra el ciclo (Entregado).
export function markDelivered(orderId: string) {
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: 'delivered' } : o))
  emit()
  notify({ text: `Pedido ${folioOf(orderId)} entregado`, roles: ['admin'], screen: 'av_ventas' })
  logAudit({ actor: 'Chofer', action: 'Entrega confirmada', resource: folioOf(orderId) })
}

// Facturación: emisión de CFDI (MOCK). Hoy genera un folio fiscal simulado;
// en la fase de Supabase + Facturama esto será una llamada real al PAC y el
// invoice_meta guardará el UUID/serie reales. La forma de orders no cambia.
function fakeFiscalUuid(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hex = (n: number, len: number) => (n >>> 0).toString(16).toUpperCase().padStart(len, '0').slice(0, len)
  const a = hex(h, 8), b = hex(h * 7, 4), c = hex(h * 13, 4), d = hex(h * 17, 4), e = hex(h * 19, 8) + hex(h * 23, 4)
  return `${a}-${b}-${c}-${d}-${e}`
}
export function markInvoiced(orderId: string) {
  const now = new Date().toISOString()
  orders = orders.map((o) =>
    o.id === orderId
      ? { ...o, invoice_requested: true, invoice_meta: { status: 'emitida', uuid: fakeFiscalUuid(o.external_ref ?? o.id), emitida_at: now } }
      : o,
  )
  emit()
  notify({ text: `CFDI emitido · ${folioOf(orderId)}`, roles: ['admin'], screen: 'av_fin' })
  logAudit({ actor: 'Administración', action: 'CFDI emitido', resource: folioOf(orderId) })
}

// Facturación: registrar el cobro (MOCK). En Supabase = update payment_status
// (o webhook de Stripe). Cierra el pendiente de "contra pedido".
export function markPaid(orderId: string) {
  orders = orders.map((o) => (o.id === orderId ? { ...o, payment_status: 'paid' } : o))
  emit()
  notify({ text: `Pago registrado · ${folioOf(orderId)}`, roles: ['admin'], screen: 'av_fin' })
  logAudit({ actor: 'Administración', action: 'Pago registrado', resource: folioOf(orderId) })
}

// Cobro EN LÍNEA del pedido (MOCK · Portal del Doctor o staff). Marca pagado,
// guarda el método y la referencia del cargo, y avanza el pedido a 'paid' para
// que entre a surtido (Almacén solo prepara lo ya pagado). En Supabase: lo
// dispara el webhook de Stripe al confirmar el PaymentIntent → mismo update.
export function payOrder(orderId: string, payment: { method: string; ref: string; actor?: string }): { ok: boolean } {
  const o = orders.find((x) => x.id === orderId)
  if (!o || o.payment_status === 'paid') return { ok: false }
  orders = orders.map((x) =>
    x.id === orderId
      ? {
          ...x,
          payment_status: 'paid',
          payment_method: payment.method,
          payment_ref: payment.ref,
          status: x.status === 'pending_payment' ? 'paid' : x.status,
        }
      : x,
  )
  emit()
  notify({ text: `Pago recibido · ${o.external_ref ?? orderId} · listo para surtir`, roles: ['warehouse'], screen: 'surtido' })
  notify({ text: `Pago recibido · ${o.external_ref ?? orderId}`, roles: ['admin'], screen: 'av_fin' })
  logAudit({ actor: payment.actor ?? 'Portal del Doctor', action: 'Pago en línea', resource: o.external_ref ?? orderId, detail: payment.method })
  return { ok: true }
}

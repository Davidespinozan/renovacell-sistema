// Store de pedidos. Con backend (hasSupabase) hidrata de `orders`+`order_items`
// (el RLS ya limita: el doctor ve SOLO los suyos, el staff TODOS) y las
// mutaciones escriben write-through; sin backend opera sobre las semillas mock.
//
// W2 · DINERO: este store YA NO escribe `payment_status` (la base lo rechaza con
// PAGO_SOLO_POR_COMANDO). El dinero se mueve con los comandos de ops/money.ts:
//   · el cliente DECLARA        → reportar_pago   (payment_claims)
//   · Facturación VERIFICA      → revisar_pago    (nace el asiento)
//   · el staff COBRA directo    → registrar_cobro (mostrador, depósito)
//   · Dirección da CRÉDITO      → autorizar_credito (libera surtido SIN decir "pagado")
// `payment_status` se lee como proyección del libro (ops/money.ts, v_order_money).
import type { Order, OrderItem } from '../types'
import type { ShippingAddress } from '../ops/shippingAddress'
import { decideTransferReview } from '../ops/transferReview'
import { normalizeFiscalProfile, validateFiscalProfile, type FiscalProfile } from '../ops/fiscal'
import { DOCTOR_ID, MOCK_ORDERS, MOCK_ORDER_ITEMS } from '../mock/orders'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { restockByReference } from './lotsStore'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import type { Json } from '../database.types'
import { runW1Command, newOpId, constraintCode, isAmbiguous, w1Code } from '../ops/w1Command'
import { confirmar, mensajeDeError, reportarFallo, type Escritura } from './escritura'
import {
  reportarPago as cmdReportarPago, registrarCobro as cmdRegistrarCobro, revisarPago as cmdRevisarPago,
  autorizarCredito as cmdAutorizarCredito, revocarCredito as cmdRevocarCredito,
  type PaymentMethod,
} from '../ops/money'
import { reloadMoney, setDemoCredit } from './moneyStore'
import { solicitarCFDI } from '../ops/fiscalIntent'

// Traduce la forma de pago de la UI al vocabulario cerrado del libro (ck_entry_method).
export function metodoW2(m: string | null | undefined): PaymentMethod {
  const v = (m ?? '').toLowerCase()
  if (v.includes('transfer')) return 'transferencia'
  if (v.includes('efec') || v.includes('cash')) return 'efectivo'
  if (v.includes('stripe')) return 'stripe'
  if (v.includes('tarjeta') || v.includes('card')) return 'tarjeta'
  return 'otro'
}

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
// Recarga tras una escritura externa (p. ej. la RPC surtir_pedido).
export function reloadOrders() { if (hasSupabase) hydrate() }

// ---- Hidratación desde Supabase (RLS acota el resultado por rol) ----
let hgen = 0 // guard de generación: una hidratación obsoleta no pisa la más nueva
async function hydrate() {
  if (!hasSupabase) return
  const g = ++hgen
  const { data, error } = await supabase
    .from('orders')
    .select('id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_ref, payment_status, stripe_payment_id, invoice_requested, invoice_meta, shipping_meta, created_at, order_items(id, order_id, product_id, lot_id, qty, unit_price, created_at)')
    .order('created_at', { ascending: false })
  if (g !== hgen) return // llegó una hidratación más nueva; ignora esta
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
  supabase.auth.onAuthStateChange((ev) => {
    // En login / cambio de sesión volvemos a "no hidratado" para no mostrar un
    // vacío falso; el refresco de token recarga en silencio.
    if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'SIGNED_OUT') { hydrated = false; hydrate() }
    else if (ev === 'TOKEN_REFRESHED') hydrate()
  })
}

// El pedido solo "se creó" cuando el servidor lo confirmó. `ambiguous` = no se sabe.
export type PedidoCreado =
  | { ok: true; order: OrderWithItems }
  | { ok: false; error: string; ambiguous: boolean }

export async function createOrder(input: {
  lines: NewOrderLine[]
  total: number
  invoice_requested: boolean
  doctor_id?: string
  customer_id?: string | null       // identidad comercial (customers.id); independiente de doctor_id/portal
  placedBy?: string
  shipping?: ShippingAddress | null  // dirección de ENTREGA elegida en la venta (base u otra)
  location_id?: string | null       // ref opcional a doctor_locations; el snapshot address sigue siendo autoritativo
  customer?: { name: string; phone?: string | null } | null // snapshot mínimo para historial (customer-only)
  receiver?: FiscalProfile | null   // perfil fiscal CONFIRMADO → congela invoice_meta.receiver del pedido
}): Promise<PedidoCreado> {
  const id = hasSupabase ? uuid() : `o-${Math.floor(Math.random() * 1e6)}`
  const folio = `S${Date.now().toString().slice(-6)}`
  const now = new Date().toISOString()
  // Identidad del pedido: doctor explícito → ese; customer-only (customer_id sin doctor) → doctor NULL
  // (NO el uid del staff); si no, fallback a la sesión (auto-pedido del doctor) / mock.
  const doctorId = input.doctor_id ?? (input.customer_id ? null : (hasSupabase ? currentUserId() : DOCTOR_ID))

  const order: Order = {
    id, external_ref: folio, doctor_id: doctorId, customer_id: input.customer_id ?? null, total: input.total, currency: 'MXN',
    status: 'pending_payment', payment_method: 'contra_pedido', payment_ref: null,
    payment_status: 'pending', stripe_payment_id: null, invoice_requested: input.invoice_requested,
    // Snapshot fiscal congelado en el momento de confirmar la solicitud (no se recalcula después).
    invoice_meta: input.receiver ? ({ receiver: normalizeFiscalProfile(input.receiver) } as unknown as Order['invoice_meta']) : null,
    // El snapshot COMPLETO de la dirección (address) es autoritativo y viaja con el pedido; el
    // location_id es solo una referencia informativa. Editar/desactivar la ubicación/cliente después
    // NO altera este snapshot histórico. `customer` = snapshot mínimo de nombre/teléfono.
    shipping_meta: (input.placedBy || input.shipping || input.location_id || input.customer)
      ? {
          ...(input.placedBy ? { placed_by: input.placedBy } : {}),
          ...(input.shipping ? { address: input.shipping } : {}),
          ...(input.location_id ? { location_id: input.location_id } : {}),
          ...(input.customer ? { customer: { id: input.customer_id ?? null, name: input.customer.name, phone: input.customer.phone ?? null } } : {}),
        }
      : null,
    created_at: now,
  }
  const newItems: OrderItem[] = input.lines.map((l, i) => ({
    id: `${id}-${i}`, order_id: id, product_id: l.product_id, lot_id: null,
    qty: l.qty, unit_price: l.unit_price, created_at: now,
  }))

  // Asienta el pedido en pantalla, avisa a Almacén y deja bitácora. SOLO se llama
  // cuando el pedido existe de verdad: antes se hacía todo esto ANTES de la respuesta
  // del servidor, así que un rechazo dejaba un aviso a Almacén de un pedido fantasma.
  const asentar = (totalServidor?: number): OrderWithItems => {
    const o = totalServidor != null && Number.isFinite(totalServidor) ? { ...order, total: totalServidor } : order
    orders = [o, ...orders]
    items = [...items, ...newItems]
    emit()
    notify({ text: `Nuevo pedido ${folio} · contra pedido`, roles: ['warehouse'], screen: 'surtido' })
    logAudit({ actor: input.placedBy ?? 'Portal del Doctor', action: 'Pedido creado', resource: folio })
    return { ...o, items: newItems }
  }

  // Sin backend, o sin identidad real que persistir: el pedido solo vive en pantalla.
  if (!(hasSupabase && (isUuid(doctorId) || isUuid(input.customer_id)))) return { ok: true, order: asentar() }

  const QUE = `crear el pedido ${folio}`
  // EL PRECIO NO LO PONE EL CLIENTE. El servidor (RPC crear_pedido, SECURITY DEFINER)
  // calcula unit_price/total desde la lista del doctor (o base/General si es customer-only);
  // aquí solo se manda {product_id, qty}.
  // IDENTIDAD COMERCIAL: un pedido Portal de un doctor debe llevar customer_id ADEMÁS de
  // doctor_id. Resuelve el customer ligado al profile del doctor (RLS: el doctor lee el suyo).
  let resolvedCustomerId: string | null = isUuid(input.customer_id) ? (input.customer_id as string) : null
  if (!resolvedCustomerId && isUuid(doctorId)) {
    const { data: c } = await supabase.from('customers').select('id').eq('profile_id', doctorId as string).maybeSingle()
    if (c?.id) resolvedCustomerId = c.id
  }

  let data: unknown = null
  let error: { message: string; code?: string } | null = null
  try {
    const r = await supabase.rpc('crear_pedido', {
      p_order_id: id,
      p_folio: folio,
      p_doctor_id: (isUuid(doctorId) ? doctorId : null) as unknown as string,
      p_customer_id: resolvedCustomerId as unknown as string,
      p_lines: input.lines.map((l) => ({ product_id: l.product_id, qty: l.qty })) as unknown as Json,
      p_shipping_meta: (order.shipping_meta ?? null) as unknown as Json,
      p_invoice_requested: input.invoice_requested,
    })
    data = r.data; error = r.error
  } catch {
    error = { message: 'Failed to fetch' }
  }

  if (error || !data) {
    const e = error ?? { message: 'respuesta vacía del servidor' }
    const reconocido = constraintCode(e.message) ?? w1Code(e.message)
    if (!reconocido && isAmbiguous(e)) {
      // RESULTADO DESCONOCIDO. El id del pedido lo generó este cliente, así que en
      // vez de adivinar se le pregunta al servidor si el pedido existe.
      const ver = await supabase.from('orders').select('id, total').eq('id', id).maybeSingle()
      if (!ver.error && ver.data) {
        const creado = asentar(Number(ver.data.total))
        hydrate()
        return { ok: true, order: creado }
      }
      if (!ver.error) {
        const msg = 'El pedido NO se registró. Puedes intentarlo de nuevo.'
        reportarFallo(QUE, msg, false)
        return { ok: false, error: msg, ambiguous: false }
      }
      const msg = 'No se pudo confirmar si el pedido quedó registrado. Revisa en "Pedidos" antes de crearlo otra vez.'
      reportarFallo(QUE, msg, true)
      return { ok: false, error: msg, ambiguous: true }
    }
    // Servidor rechazó (precio inválido, producto inactivo, no autorizado…).
    const msg = mensajeDeError(e, 'comando')
    reportarFallo(QUE, msg, false)
    return { ok: false, error: msg, ambiguous: false }
  }

  const creado = asentar(Number((data as { total?: number }).total))
  // Congela el snapshot fiscal server-side una vez que el pedido ya existe (RPC acotada).
  if (input.receiver) {
    const rpc = (supabase.rpc as unknown as (fn: string, args: unknown) => Promise<{ error: { message: string } | null }>)
    const { error: fErr } = await rpc('set_order_fiscal_snapshot', { p_order_id: id, p_receiver: normalizeFiscalProfile(input.receiver) })
    // El pedido SÍ existe; lo que no quedó son sus datos fiscales. Se dice tal cual.
    if (fErr) reportarFallo(`guardar los datos fiscales del pedido ${folio}`,
      'El pedido sí se creó, pero sus datos fiscales no quedaron guardados. Captúralos en Facturación antes de solicitar la factura.', false)
  }
  hydrate() // trae unit_price/total AUTORITATIVOS del servidor
  return { ok: true, order: creado }
}

const CANCELABLE = ['draft', 'pending_payment', 'paid', 'picking', 'packed']
export const isCancelable = (status: string | null): boolean => CANCELABLE.includes(status ?? '')
// Modo demo (sin backend): cancelación local con reingreso inmediato. Con backend la
// cancelación es SOLO el comando del servidor `cancelar_pedido` (ver cancelarPedido).
export function cancelOrder(orderId: string, actor = 'Administración'): { ok: boolean } {
  if (hasSupabase) return { ok: false }
  const o = orders.find((x) => x.id === orderId)
  if (!o || !isCancelable(o.status)) return { ok: false }
  if (o.status === 'packed') restockByReference(o.external_ref ?? o.id)
  orders = orders.map((x) => (x.id === orderId ? { ...x, status: 'cancelled' } : x))
  emit()
  notify({ text: `Pedido ${o.external_ref ?? orderId} cancelado`, roles: ['admin'], screen: 'av_ventas' })
  logAudit({ actor, action: 'Pedido cancelado', resource: o.external_ref ?? orderId })
  return { ok: true }
}

export interface CancelResult {
  ok: boolean; error?: string; code?: string; ambiguous?: boolean; status?: string
  refundReview?: 'no_aplica' | 'pendiente_revision'; reingresoPendiente?: boolean
}
// W1 · D-03: cancelación atómica e idempotente EN EL SERVIDOR. Reglas por etapa (sin pagar:
// doctor/staff; pagado/picking/empacado: solo Dirección con motivo; enviado/entregado/POS:
// devolución), marca "reembolso pendiente de revisión" si hay dinero y, si estaba empacado,
// deja el reingreso PENDIENTE de confirmación física de Almacén. Sin éxito optimista.
export async function cancelarPedido(orderId: string, opts: { opId: string; reason?: string | null; actor?: string }): Promise<CancelResult> {
  if (!hasSupabase) {
    const r = cancelOrder(orderId, opts.actor ?? 'Administración')
    return r.ok ? { ok: true, status: 'applied', refundReview: 'no_aplica', reingresoPendiente: false } : { ok: false, error: 'Este pedido ya no se puede cancelar.' }
  }
  const r = await runW1Command<{ refund_review?: 'no_aplica' | 'pendiente_revision'; reingreso_pendiente?: boolean }>(
    'cancelar_pedido', { p_op_id: opts.opId, p_order: orderId, p_reason: opts.reason?.trim() || undefined }, opts.opId)
  if (!r.ok) return { ok: false, error: r.error, code: r.code, ambiguous: r.ambiguous }
  await hydrate()
  if (r.status === 'applied') {
    notify({ text: `Pedido ${folioOf(orderId)} cancelado${r.data.reingreso_pendiente ? ' · reingreso por confirmar' : ''}`, roles: ['admin', 'warehouse'], screen: r.data.reingreso_pendiente ? 'devoluciones' : 'av_ventas' })
    logAudit({ actor: opts.actor ?? 'Administración', action: 'Pedido cancelado', resource: folioOf(orderId), detail: opts.reason ?? undefined })
  }
  return { ok: true, status: r.status, refundReview: r.data.refund_review, reingresoPendiente: !!r.data.reingreso_pendiente }
}

export interface PosOrderLine { product_id: string; qty: number; unit_price: number; lot_id: string | null }
// shipping_meta de una venta POS: DETERMINISTA (sin timestamps) para que un reintento de la
// misma venta mande exactamente el mismo contenido (idempotencia por order_id en vender_pos).
export function posShippingMeta(input: { channel?: string; event_id?: string | null; seller?: string | null; customer_id?: string | null; customer?: { name: string; phone?: string | null } | null }): Record<string, unknown> {
  return {
    channel: input.channel ?? 'pos', event_id: input.event_id ?? null, seller: input.seller ?? null,
    ...(input.customer ? { customer: { id: input.customer_id ?? null, name: input.customer.name, phone: input.customer.phone ?? null } } : {}),
  }
}
export function createPosOrder(input: {
  lines: PosOrderLine[]
  total: number
  payment_method: string
  event_id?: string | null
  seller?: string | null
  doctor_id?: string | null
  customer_id?: string | null
  customer?: { name: string; phone?: string | null } | null
  channel?: string
  invoice_requested?: boolean
  invoice_meta?: Record<string, unknown> | null
  id?: string      // W1: id/folio confirmados por vender_pos (el ticket refleja la venta del servidor)
  folio?: string
}, localOnly = false): OrderWithItems {
  const invoiceReq = input.invoice_requested ?? false
  const invoiceMeta = input.invoice_meta ?? null
  const id = input.id ?? (hasSupabase ? uuid() : `pos-${Math.floor(Math.random() * 1e6)}`)
  const folio = input.folio ?? `POS-${Date.now().toString().slice(-6)}`
  const now = new Date().toISOString()
  const shipping_meta = posShippingMeta(input)

  const order: Order = {
    id, external_ref: folio, doctor_id: input.doctor_id ?? null, customer_id: input.customer_id ?? null, total: input.total, currency: 'MXN',
    status: 'delivered', payment_method: input.payment_method, payment_ref: null,
    payment_status: 'paid', stripe_payment_id: null, invoice_requested: invoiceReq,
    invoice_meta: invoiceMeta as Order['invoice_meta'], shipping_meta, created_at: now,
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

  // Con backend la venta la persiste SOLO vender_pos (W1); aquí se refleja lo ya confirmado.
  void localOnly
  return { ...order, items: newItems }
}

export function markPacked(orderId: string, itemLot: Record<string, string | null>, localOnly = false) {
  // Solo se empaca un pedido PAGADO y aún no empacado (no saltar pago/estado).
  const cur = orders.find((o) => o.id === orderId)
  if (!cur || !['paid', 'picking'].includes(cur.status ?? '')) return
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: 'packed' } : o))
  items = items.map((it) => (it.order_id === orderId && itemLot[it.id] !== undefined ? { ...it, lot_id: itemLot[it.id] } : it))
  emit()
  notify({ text: `Pedido ${folioOf(orderId)} surtido · por empacar`, roles: ['warehouse'], screen: 'cola' })
  logAudit({ actor: 'Almacén', action: 'Surtido (FEFO)', resource: folioOf(orderId) })
  // Con backend, 'packed' y los lotes por renglón los escribe SOLO surtir_pedido (W1);
  // esta función refleja localmente lo ya confirmado (aviso + bitácora).
  void localOnly
}

export async function markShipped(orderId: string, shipping_meta: Record<string, unknown>): Promise<Escritura> {
  const merged = orders.find((o) => o.id === orderId)
  // Solo se envía lo ya empacado. No es un fallo del servidor: la pantalla está desfasada.
  if (!merged || merged.status !== 'packed') return { ok: false, error: 'Este pedido ya no está empacado: recarga para ver su estado actual.', ambiguous: false }
  const nextMeta = { ...((merged?.shipping_meta as object | null) ?? {}), ...shipping_meta }
  if (hasSupabase && isUuid(orderId)) {
    const r = await confirmar(`marcar el pedido ${folioOf(orderId)} como enviado`,
      supabase.from('orders').update({ status: 'shipped', shipping_meta: nextMeta as unknown as Json }).eq('id', orderId))
    if (!r.ok) { hydrate(); return r }
  }
  // Recién ahora, con el servidor confirmado: estado, aviso y bitácora.
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: 'shipped', shipping_meta: nextMeta } : o))
  emit()
  notify({ text: `Pedido ${folioOf(orderId)} en camino`, roles: ['admin'], screen: 'seguimiento' })
  logAudit({ actor: 'Empaque', action: 'Envío asignado', resource: folioOf(orderId) })
  return { ok: true }
}

// `remote: false` actualiza solo la pantalla: lo usa ops/entregar, donde quien
// escribe en la base es el RPC `confirmar_entrega` (el chofer no tiene permiso
// de escribir `orders` directamente).
export async function markDelivered(orderId: string, opts: { remote?: boolean } = {}): Promise<Escritura> {
  const cur = orders.find((o) => o.id === orderId)
  // Solo se entrega lo que salió (enviado).
  if (!cur || cur.status !== 'shipped') return { ok: false, error: 'Este pedido no está en camino: recarga para ver su estado actual.', ambiguous: false }
  if (opts.remote !== false && hasSupabase && isUuid(orderId)) {
    const r = await confirmar(`marcar el pedido ${folioOf(orderId)} como entregado`,
      supabase.from('orders').update({ status: 'delivered' }).eq('id', orderId))
    if (!r.ok) { hydrate(); return r }
  }
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: 'delivered' } : o))
  emit()
  notify({ text: `Pedido ${folioOf(orderId)} entregado`, roles: ['admin'], screen: 'av_ventas' })
  logAudit({ actor: 'Chofer', action: 'Entrega confirmada', resource: folioOf(orderId) })
  return { ok: true }
}

function fakeFiscalUuid(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hex = (n: number, len: number) => (n >>> 0).toString(16).toUpperCase().padStart(len, '0').slice(0, len)
  const a = hex(h, 8), b = hex(h * 7, 4), c = hex(h * 13, 4), d = hex(h * 17, 4), e = hex(h * 19, 8) + hex(h * 23, 4)
  return `${a}-${b}-${c}-${d}-${e}`
}
// SNAPSHOT fiscal por pedido: congela orders.invoice_meta.receiver (el receptor confirmado para
// ESE CFDI) vía RPC acotada. Se llama al CONFIRMAR la solicitud de factura (no espera al pago) y
// desde el editor de Facturación. Un CFDI ya timbrado NO admite cambio de receptor.
export async function setOrderFiscalSnapshot(orderId: string, receiver: FiscalProfile): Promise<{ ok: boolean; error?: string }> {
  const v = validateFiscalProfile(receiver)
  if (!v.ok) return { ok: false, error: Object.values(v.errors)[0] ?? 'Datos fiscales incompletos.' }
  const clean = normalizeFiscalProfile(receiver)
  const o = orders.find((x) => x.id === orderId)
  if (o) {
    const inv = (o.invoice_meta as Record<string, unknown> | null) ?? {}
    if (inv.status === 'timbrada' || inv.status === 'emitida') return { ok: false, error: 'El CFDI ya fue emitido; no se puede cambiar el receptor.' }
    const nextInv = { ...inv, receiver: clean }
    orders = orders.map((x) => (x.id === orderId ? { ...x, invoice_requested: true, invoice_meta: nextInv as unknown as Order['invoice_meta'] } : x))
    emit()
  }
  if (hasSupabase && isUuid(orderId)) {
    const rpc = (supabase.rpc as unknown as (fn: string, args: unknown) => Promise<{ error: { message: string } | null }>)
    const { error } = await rpc('set_order_fiscal_snapshot', { p_order_id: orderId, p_receiver: clean })
    if (error) { hydrate(); return { ok: false, error: error.message } }
    hydrate()
  }
  return { ok: true }
}

// W3-A · SOLICITAR LA FACTURA. Ya NO timbra desde el cliente.
//
// Lo que había aquí era el mecanismo P0 completo: se invocaba la Edge Function `cfdi` y, ante
// cualquier fallo —incluido un timeout DESPUÉS de que el PAC ya hubiera timbrado—, el cliente
// ejecutaba `update({ invoice_meta: null })`. Eso borraba el folio fiscal que el servidor sí
// había guardado, dejaba `invoice_requested = true` y la UI volvía a ofrecer "Emitir CFDI":
// un segundo CFDI real ante el SAT, sin que el operador hiciera nada mal.
//
// Ese camino está cerrado por tres lados a la vez:
//   1. la base rechaza toda escritura del cliente sobre invoice_meta/invoice_requested
//      (FISCAL_SOLO_POR_COMANDO);
//   2. aquí no queda ninguna escritura de evidencia fiscal, ni en el éxito ni en el fallo;
//   3. la Edge Function `cfdi` no sale al PAC (contención W3-A).
//
// Lo único que hace esta función es registrar la INTENCIÓN durable. Nada se pierde y nada
// se duplica: si el timbrado ya estuviera hecho, el servidor lo dice y no se vuelve a intentar.
export async function markInvoiced(orderId: string): Promise<{ ok: boolean; error?: string; status?: string }> {
  const now = new Date().toISOString()
  // Modo MOCK (sin backend / id no-UUID): folio SIMULADO en memoria (marca `simulated`).
  // Se conserva el comportamiento demo existente: no hay base, no hay evidencia fiscal real.
  if (!hasSupabase || !isUuid(orderId)) {
    const meta: Record<string, unknown> = { status: 'emitida', uuid: fakeFiscalUuid(orderId), emitida_at: now, simulated: true }
    orders = orders.map((o) => (o.id === orderId ? { ...o, invoice_requested: true, invoice_meta: meta } : o))
    emit()
    notify({ text: `CFDI emitido · ${folioOf(orderId)}`, roles: ['admin'], screen: 'av_fin' })
    logAudit({ actor: 'Administración', action: 'CFDI emitido', resource: folioOf(orderId) })
    return { ok: true, status: 'simulado' }
  }

  const r = await solicitarCFDI(orderId)
  if (!r.ok) {
    notify({ text: `Factura · ${r.error}`, roles: ['admin'], screen: 'av_fin' })
    await hydrate()
    return { ok: false, error: r.error }
  }
  // El servidor decide qué pasó. `already_stamped` significa que el CFDI YA existe: no se
  // reintenta ni se reescribe nada.
  const texto = r.data.status === 'already_stamped'
    ? `Este pedido ya tiene CFDI emitido · ${folioOf(orderId)}`
    : `Factura solicitada · ${folioOf(orderId)} · el timbrado se habilita al completar W3-B`
  notify({ text: texto, roles: ['admin'], screen: 'av_fin' })
  logAudit({ actor: 'Administración', action: 'Solicitud de CFDI registrada', resource: folioOf(orderId) })
  await hydrate()
  return { ok: true, status: r.data.status }
}

// COBRO DIRECTO (Dirección/Facturación/POS): el dinero ya está en la casa y se
// registra en el libro. No "marca pagado": crea el ASIENTO y el servidor recalcula
// `payment_status` a partir de él (pending → parcial → paid según lo que entró).
export async function registrarCobroDePedido(opId: string, a: {
  orderId: string; method: PaymentMethod; amount: number
  fechaValor?: string | null; reference?: string | null; bankAccountId?: string | null; evidence?: string | null
  actor?: string
}): Promise<{ ok: boolean; error?: string; ambiguous?: boolean; payment_status?: string; saldo?: number; sobrepago?: boolean }> {
  const o = orders.find((x) => x.id === a.orderId)
  if (!o) return { ok: false, error: 'No se encontró el pedido.' }
  if (a.amount <= 0) return { ok: false, error: 'El monto debe ser mayor a cero.' }

  if (!hasSupabase || !isUuid(a.orderId)) {
    // Demo: espeja el efecto para poder mostrar el flujo.
    orders = orders.map((x) => (x.id === a.orderId ? { ...x, payment_status: 'paid', status: x.status === 'pending_payment' ? 'paid' : x.status } : x))
    emit()
    avisarCobro(a.orderId, o)
    return { ok: true, payment_status: 'paid', saldo: 0 }
  }

  const r = await cmdRegistrarCobro(opId, a)
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
  await reloadMoney()
  await hydrate()
  if (r.status === 'applied') {
    logAudit({ actor: a.actor ?? 'Administración', action: 'Cobro registrado', resource: folioOf(a.orderId), detail: `$${a.amount} · ${a.method}` })
    // Solo se avisa "listo para surtir" cuando el servidor dice que ya quedó pagado.
    if (r.data.payment_status === 'paid') avisarCobro(a.orderId, o)
    else notify({ text: `Pago parcial · ${o.external_ref ?? folioOf(a.orderId)} · falta ${r.data.saldo}`, roles: ['admin'], screen: 'av_fin' })
  }
  return { ok: true, payment_status: r.data.payment_status, saldo: r.data.saldo, sobrepago: r.data.sobrepago }
}

// Avisos de "ya entró el dinero" (Almacén + Dirección + el doctor dueño).
function avisarCobro(orderId: string, o: Order) {
  notify({ text: `Pago registrado · ${folioOf(orderId)}`, roles: ['admin'], screen: 'av_fin' })
  notify({ text: `Pago confirmado · ${o.external_ref ?? folioOf(orderId)} · listo para surtir`, roles: ['warehouse'], screen: 'surtido' })
  if (o.doctor_id) notify({ text: `Tu pago del pedido ${o.external_ref ?? folioOf(orderId)} quedó confirmado; ya entró a preparación.`, userIds: [o.doctor_id], screen: 'pedidosdr' })
}

// DECLARAR un pago (el cliente o el staff informa que pagó). NO mueve dinero: abre un
// comprobante en revisión. Reportar ≠ cobrar.
export async function reportarPagoDePedido(opId: string, a: {
  orderId: string; method: PaymentMethod; amount: number
  reference?: string | null; bankAccountId?: string | null; proofPath?: string | null; actor?: string
}): Promise<{ ok: boolean; error?: string; ambiguous?: boolean; claimId?: string }> {
  if (!hasSupabase || !isUuid(a.orderId)) return { ok: true }
  const r = await cmdReportarPago(opId, a)
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
  await reloadMoney()
  await hydrate()
  if (r.status === 'applied') {
    logAudit({ actor: a.actor ?? 'Portal del Doctor', action: 'Pago reportado', resource: folioOf(a.orderId), detail: `$${a.amount} · ${a.method}` })
    notify({ text: `Pago informado · ${folioOf(a.orderId)} · verifica que cayó`, roles: ['admin'], screen: 'av_pagos' })
  }
  return { ok: true, claimId: r.data.claim_id }
}

// CONFIRMAR / RECHAZAR un comprobante declarado, de forma ATÓMICA y auditada por el
// servidor (revisar_pago, SECURITY DEFINER, solo Dirección/Facturación).
// - verificar → nace el ASIENTO; el servidor recalcula payment_status.
// - rechazar  → deja el pedido SIN pagar, con motivo, y lo saca de la cola; el cliente
//   puede volver a reportar.
export async function reviewTransfer(
  orderId: string,
  action: 'confirm' | 'reject',
  reason?: string,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const o = orders.find((x) => x.id === orderId)
  if (!o) return { ok: false, error: 'Pedido no encontrado.' }
  if (action === 'reject' && !reason?.trim()) return { ok: false, error: 'El rechazo necesita un motivo.' }

  // Autoridad server-side cuando hay backend.
  if (hasSupabase && isUuid(orderId)) {
    // El comprobante ABIERTO se busca fresco (uq_claim_abierta garantiza a lo más uno).
    const { data: claim, error: qerr } = await supabase.from('payment_claims')
      .select('id').eq('order_id', orderId).eq('status', 'reportado').maybeSingle()
    if (qerr) return { ok: false, error: qerr.message }
    if (!claim) return { ok: false, error: 'El pedido no tiene una transferencia por revisar.' }
    const r = await cmdRevisarPago(newOpId(), {
      claimId: (claim as { id: string }).id,
      accion: action === 'confirm' ? 'verificar' : 'rechazar',
      motivo: reason ?? null,
    })
    if (!r.ok) return { ok: false, error: r.error }
    await reloadMoney()
    await hydrate()
    const nuevo = r.status === 'applied'
    if (action === 'confirm') {
      if (nuevo) {
        notify({ text: `Transferencia confirmada · ${o.external_ref ?? folioOf(orderId)} · listo para surtir`, roles: ['warehouse'], screen: 'surtido' })
        notify({ text: `Pago confirmado · ${o.external_ref ?? folioOf(orderId)}`, roles: ['admin'], screen: 'av_pagos' })
        if (o.doctor_id) notify({ text: `Tu pago del pedido ${o.external_ref ?? folioOf(orderId)} quedó confirmado; ya entró a preparación.`, userIds: [o.doctor_id], screen: 'pedidosdr' })
        logAudit({ actor: 'Administración', action: 'Transferencia confirmada', resource: folioOf(orderId) })
      }
    } else if (nuevo) {
      logAudit({ actor: 'Administración', action: 'Transferencia rechazada', resource: folioOf(orderId), detail: reason })
      if (o.doctor_id) notify({ text: `No confirmamos tu transferencia del pedido ${o.external_ref ?? folioOf(orderId)}${reason ? ` (${reason})` : ''}. Reintenta el pago o usa otro método.`, userIds: [o.doctor_id], screen: 'pedidosdr' })
    }
    return { ok: true, status: r.status }
  }

  // Demo (sin backend): reproduce la máquina de estados vía la función pura.
  const prevTransfer = ((o.shipping_meta as Record<string, unknown> | null)?.transfer as Record<string, unknown> | null) ?? {}
  const d = decideTransferReview(
    { paymentStatus: o.payment_status ?? 'pending', reported: prevTransfer.reported === true, reviewStatus: (prevTransfer.review as { status?: string } | undefined)?.status },
    action, reason,
  )
  if (!d.ok) return d
  if (d.effect !== 'noop') applyReviewLocally(orderId, action, reason, d.status)
  return { ok: true, status: d.status }
}

// Espejo local del efecto (SOLO demo, sin backend).
function applyReviewLocally(orderId: string, action: 'confirm' | 'reject', reason: string | undefined, status?: string) {
  const o = orders.find((x) => x.id === orderId)
  if (!o) return
  const prevMeta = (o.shipping_meta as Record<string, unknown> | null) ?? {}
  const prevTransfer = (prevMeta.transfer as Record<string, unknown> | null) ?? {}
  const now = new Date().toISOString()
  const noop = status === 'already_confirmed' || status === 'already_rejected'
  if (action === 'confirm') {
    const nextMeta = { ...prevMeta, transfer: { ...prevTransfer, reported: false, review: { status: 'confirmed', reviewed_at: now, reviewed_by: 'Administración' } } }
    orders = orders.map((x) => (x.id === orderId ? { ...x, payment_status: 'paid', status: x.status === 'pending_payment' ? 'paid' : x.status, shipping_meta: nextMeta } : x))
    emit()
    if (noop) return
    notify({ text: `Transferencia confirmada · ${o.external_ref ?? folioOf(orderId)} · listo para surtir`, roles: ['warehouse'], screen: 'surtido' })
    notify({ text: `Pago confirmado · ${o.external_ref ?? folioOf(orderId)}`, roles: ['admin'], screen: 'av_pagos' })
    if (o.doctor_id) notify({ text: `Tu pago del pedido ${o.external_ref ?? folioOf(orderId)} quedó confirmado; ya entró a preparación.`, userIds: [o.doctor_id], screen: 'pedidosdr' })
    logAudit({ actor: 'Administración', action: 'Transferencia confirmada', resource: folioOf(orderId) })
  } else {
    const nextMeta = { ...prevMeta, transfer: { ...prevTransfer, reported: false, review: { status: 'rejected', reviewed_at: now, reviewed_by: 'Administración', reason: (reason ?? '').slice(0, 400) } } }
    orders = orders.map((x) => (x.id === orderId ? { ...x, shipping_meta: nextMeta } : x))
    emit()
    if (noop) return
    logAudit({ actor: 'Administración', action: 'Transferencia rechazada', resource: folioOf(orderId), detail: reason })
    if (o.doctor_id) notify({ text: `No confirmamos tu transferencia del pedido ${o.external_ref ?? folioOf(orderId)}${reason ? ` (${reason})` : ''}. Reintenta el pago o usa otro método.`, userIds: [o.doctor_id], screen: 'pedidosdr' })
  }
}

// CRÉDITO (contra pedido) — solo Dirección. Libera el surtido SIN tocar `payment_status`
// ni `status`: el pedido sigue debiendo y así se muestra.
export async function autorizarCreditoDePedido(opId: string, a: { orderId: string; dueDate: string; motivo: string }): Promise<{ ok: boolean; error?: string; ambiguous?: boolean }> {
  const o = orders.find((x) => x.id === a.orderId)
  if (!o) return { ok: false, error: 'No se encontró el pedido.' }
  if (!hasSupabase || !isUuid(a.orderId)) {
    setDemoCredit(a.orderId, { due_date: a.dueDate })
    emit()
    return { ok: true }
  }
  const r = await cmdAutorizarCredito(opId, a)
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
  await reloadMoney()
  await hydrate()
  if (r.status === 'applied') {
    logAudit({ actor: 'Dirección', action: 'Crédito autorizado', resource: folioOf(a.orderId), detail: `vence ${a.dueDate} · ${a.motivo}` })
    notify({ text: `Crédito autorizado · ${o.external_ref ?? folioOf(a.orderId)} · puedes surtir (el pedido sigue por cobrar)`, roles: ['warehouse'], screen: 'surtido' })
    notify({ text: `Crédito autorizado · ${o.external_ref ?? folioOf(a.orderId)} · vence ${a.dueDate}`, roles: ['admin'], screen: 'av_fin' })
  }
  return { ok: true }
}

export async function revocarCreditoDePedido(opId: string, a: { orderId: string; motivo: string }): Promise<{ ok: boolean; error?: string; ambiguous?: boolean }> {
  if (!hasSupabase || !isUuid(a.orderId)) { setDemoCredit(a.orderId, null); emit(); return { ok: true } }
  const r = await cmdRevocarCredito(opId, a)
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
  await reloadMoney()
  await hydrate()
  if (r.status === 'applied') logAudit({ actor: 'Dirección', action: 'Crédito revocado', resource: folioOf(a.orderId), detail: a.motivo })
  return { ok: true }
}

// Pago desde el Portal del Doctor. Con backend el doctor NO puede cobrarse a sí mismo:
// DECLARA el pago (reportar_pago) y Facturación lo verifica — ahí nace el asiento. El
// cobro en línea real entra por el webhook del proveedor (registrar_cobro, service_role).
// Sin backend (demo) se simula el cobro para poder mostrar el flujo completo.
export function payOrder(orderId: string, payment: { method: string; ref: string; actor?: string }): { ok: boolean } {
  const o = orders.find((x) => x.id === orderId)
  if (!o || o.payment_status === 'paid') return { ok: false }

  if (hasSupabase && isUuid(orderId)) {
    void reportarPagoDePedido(newOpId(), {
      orderId, method: metodoW2(payment.method), amount: o.total ?? 0,
      reference: payment.ref, actor: payment.actor ?? 'Portal del Doctor',
    })
    return { ok: true }
  }

  orders = orders.map((x) =>
    x.id === orderId
      ? { ...x, payment_status: 'paid', payment_method: payment.method, payment_ref: payment.ref, status: x.status === 'pending_payment' ? 'paid' : x.status }
      : x,
  )
  emit()
  notify({ text: `Pago recibido · ${o.external_ref ?? orderId} · listo para surtir`, roles: ['warehouse'], screen: 'surtido' })
  notify({ text: `Pago recibido · ${o.external_ref ?? orderId}`, roles: ['admin'], screen: 'av_fin' })
  logAudit({ actor: payment.actor ?? 'Portal del Doctor', action: 'Pago en línea', resource: o.external_ref ?? orderId, detail: payment.method })
  return { ok: true }
}

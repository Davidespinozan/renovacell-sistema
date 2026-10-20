// Edge Function: PAQUETERÍA server-side (cotizar + crear guía + tracking), llaves
// PROTEGIDAS en el servidor. Multiproveedor: DHL (MyDHL API) como primer provider,
// con un contrato interno ShippingProvider { quote, createShipment, track } listo
// para agregar T1 sin reescribir Packing.
//
// - Acciones NEUTRAS (DHL): 'rate' | 'create_shipment' | 'track'.
// - Acciones LEGADAS (agregador Envia/mock, intactas): 'quote' | 'label'.
// - Seam: si no hay credenciales del provider pedido → 501 → el cliente cae al mock.
//
// Secrets (solo aquí, nunca en el cliente / VITE / repo):
//   DHL_API_USERNAME, DHL_API_PASSWORD, DHL_ACCOUNT_NUMBER, DHL_API_ENV(test|production)
//   T1_API_URL, T1_AUTH_URL, T1_CLIENT_ID, T1_CLIENT_SECRET, T1_USERNAME, T1_PASSWORD, T1_SHOP_ID, T1_COMERCIO_ID, T1_ORIGEN_COLONIA (T1 Envíos; `provider: 't1'`)
//   (legado) SHIPPING_API_KEY, SHIPPING_API_URL, SHIPPING_RATE_PATH, SHIPPING_LABEL_PATH
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { observador } from '../_shared/observa.ts'

// W6-A3.3 · telemetría opcional (no-op sin SENTRY_DSN; nunca altera la respuesta).
const obs = observador('shipping')
import {
  buildRateRequest, parseRates, buildShipmentRequest, parseShipment, parseTracking,
  dhlErrorMessage, dhlBaseUrl, isTrackingNoData, emptyTrackingResult, buildPickupRequest, parsePickup,
  type NeutralShipper, type NeutralReceiver, type NeutralPackage,
} from './dhl.ts'
import { conCors } from '../_shared/cors.ts'   // CC-0B.2 · lista blanca de orígenes (antes '*')
import { resumenDhl, recibioSegunPaqueteria, debeConsultar } from './rastreo.ts'   // PAQ-A · rastreo neutral
import { errorRecoleccion, limpiarRecoleccion, ahoraLocalOrigen, type RecoleccionSolicitada } from './recoleccion.ts'   // PAQ-B · recolección
import { t1Config, t1Token, cabecerasT1, buildQuoteT1, parseQuoteT1, buildGuideT1, parseGuideT1, parseTrackingT1, buildPickupT1, parsePickupT1, t1ErrorMessage, T1_SECRETOS } from './t1.ts'   // T1 · segundo proveedor
import { resumenT1 } from './rastreo.ts'

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const LABELS_BUCKET = 'shipping-labels'
const SIGNED_TTL = 3600 // 1 h; label_path persiste → se puede re-firmar luego

// ---- Validación server-side (autoridad; espejo de data/shipping/validate.ts) ----
const s = (v: unknown) => String(v ?? '').trim()
const n = (v: unknown) => { const x = typeof v === 'number' ? v : Number(String(v ?? '').trim()); return Number.isFinite(x) ? x : null }

// Destinatario + paquete (el ORIGEN ya NO viene del cliente; se carga server-side).
function missingReceiverPkg(receiver: NeutralReceiver, pkg: NeutralPackage): string[] {
  const m: string[] = []
  if (!s(receiver?.name)) m.push('nombre del destinatario')
  if (!s(receiver?.address?.line1)) m.push('calle/dirección de entrega')
  if (!s(receiver?.address?.cp)) m.push('código postal (CP) de entrega')
  if (!s(receiver?.address?.city)) m.push('ciudad de entrega')
  if (!s(receiver?.address?.phone)) m.push('teléfono de entrega')
  const w = n(pkg?.weightKg); if (w == null || w <= 0) m.push('peso (kg)')
  const l = n(pkg?.lengthCm); if (l == null || l <= 0) m.push('largo (cm)')
  const a = n(pkg?.widthCm); if (a == null || a <= 0) m.push('ancho (cm)')
  const h = n(pkg?.heightCm); if (h == null || h <= 0) m.push('alto (cm)')
  const pc = n(pkg?.pieces); if (pc == null || pc < 1 || !Number.isInteger(pc)) m.push('número de piezas')
  return m
}

// ORIGEN (shipper) desde company_settings — AUTORIDAD del servidor + gate de go-live.
// Sin fallback a ORIGIN hardcodeado / fiscal / perfil. Si falta config → lista de faltantes.
// deno-lint-ignore no-explicit-any
async function companyShipper(admin: any): Promise<{ shipper: NeutralShipper; missing: string[] }> {
  const { data: c } = await admin.from('company_settings')
    .select('shipping_name,shipping_address,shipping_cp,shipping_city,shipping_state,shipping_country,shipping_phone,shipping_email')
    .eq('id', 'default').maybeSingle()
  const shipper: NeutralShipper = {
    name: s(c?.shipping_name), addressLine1: s(c?.shipping_address), cp: s(c?.shipping_cp),
    city: s(c?.shipping_city), state: s(c?.shipping_state), country: s(c?.shipping_country) || 'MX',
    phone: s(c?.shipping_phone), email: s(c?.shipping_email),
  }
  const req: [keyof NeutralShipper, string][] = [['name', 'razón social'], ['addressLine1', 'dirección'], ['cp', 'CP'], ['city', 'ciudad'], ['phone', 'teléfono'], ['email', 'email']]
  const missing = req.filter(([k]) => !s(shipper[k])).map(([, l]) => `origen: ${l}`)
  return { shipper, missing }
}

const safeErr = (msg: string) => msg.slice(0, 300)
// deno-lint-ignore no-explicit-any
async function failAttempt(admin: any, id: string, err: string) {
  await admin.from('shipping_attempts').update({ status: 'failed_safe_to_retry', error: safeErr(err), updated_at: new Date().toISOString() }).eq('id', id)
}
// deno-lint-ignore no-explicit-any
async function markUnknown(admin: any, id: string, err: string) {
  await admin.from('shipping_attempts').update({ status: 'unknown_requires_reconciliation', error: safeErr(err), updated_at: new Date().toISOString() }).eq('id', id)
}
async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
// Payload de etiqueta para una guía existente (idempotente). Costo desde el shipment (server).
// deno-lint-ignore no-explicit-any
async function labelPayload(admin: any, sh: any) {
  let labelUrl = ''
  if (sh.label_path) { const { data: sg } = await admin.storage.from(LABELS_BUCKET).createSignedUrl(sh.label_path, SIGNED_TTL); labelUrl = sg?.signedUrl ?? '' }
  return { provider: s(sh.provider) || 'dhl', carrier: sh.carrier ?? 'DHL', service: (s(sh.provider) || 'dhl') === 't1' ? `T1 · ${sh.carrier ?? ''}`.trim() : 'DHL Express', serviceCode: sh.service_code, tracking: sh.tracking_number, labelUrl, amount: Number(sh.provider_cost ?? 0), currency: sh.currency ?? 'MXN', estimatedDeliveryAt: sh.estimated_delivery_at ?? '' }
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  // AUTH: usuario + rol de logística (igual que hoy).
  const sbUrl = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const caller = createClient(sbUrl, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(sbUrl, service, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  const who = { user: { id: q.quien.uid } }
  const esLogistica = tieneRol(q.quien, ['admin', 'warehouse', 'packing'])

  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = p.action

  // ===================== PAQ-A · RASTREO (sincronizar un envío con la paquetería) =====================
  // Lo puede pedir quien YA ve el envío (logística, el chofer asignado o el dueño del pedido): la visibilidad la
  // decide la RLS de `shipments` con la identidad del llamante. Se consulta a la paquetería como mucho una vez cada
  // 10 min por envío (forzar es solo de logística) y nunca después de entregado.
  if (action === 'sync_tracking') {
    const orderId = s(p.order_id)
    if (!orderId) return json(400, { error: 'Falta order_id.' })
    const { data: sh, error: shErr } = await caller.from('shipments')
      .select('id, tracking_number, provider, carrier, status').eq('order_id', orderId).not('tracking_number', 'is', null).limit(1).maybeSingle()
    if (shErr) return json(500, { error: 'No se pudo leer el envío.' })
    if (!sh) return json(404, { error: 'sin_guia', message: 'Ese pedido no tiene una guía de paquetería a tu alcance.' })
    const proveedor = s(sh.provider) || 'dhl'
    const { data: prev } = await admin.from('shipment_tracking').select('estado, synced_at').eq('shipment_id', sh.id).maybeSingle()
    const cerrado = sh.status === 'delivered' || sh.status === 'cancelado'
    let consultado = false, cierre: 'cerrado' | 'pendiente' | null = null, aviso: string | null = null
    if (!cerrado && debeConsultar(prev, Date.now(), p.force === true && esLogistica)) {
      if (proveedor === 't1') {
        // T1 · GET /webhook-maestro/query/estado-guia/:guia → familia_externa → estado neutral.
        const cfg = t1Config(Deno.env.get)
        if (!cfg) return json(501, { error: 'not_configured', message: 'T1 no habilitado.' })
        try {
          const tk = await t1Token(cfg)
          const r = await fetch(`${cfg.base}/webhook-maestro/query/estado-guia/${encodeURIComponent(s(sh.tracking_number))}`, { headers: cabecerasT1(cfg, tk) })
          const data = await r.json().catch(() => ({}))
          consultado = true
          if (!r.ok) {
            obs('sync_tracking', 'provider_error', { code: r.status, mensaje: 'T1 respondió error en rastreo' })
            await admin.rpc('registrar_rastreo', { p_shipment: sh.id, p_provider: proveedor, p_estado: null, p_error: `T1 ${r.status}` })
          } else {
            const res = resumenT1(data)
            const { error: regErr } = await admin.rpc('registrar_rastreo', {
              p_shipment: sh.id, p_provider: proveedor, p_estado: res.estado, p_descripcion: res.descripcion,
              p_firmado_por: res.firmadoPor, p_entregado_at: res.entregadoAt, p_eventos: res.eventos, p_error: null,
            })
            if (regErr) return json(500, { error: 'No se pudo guardar el rastreo.' })
            if (res.estado === 'entregado' && esLogistica) {
              const { error: ceErr } = await caller.rpc('confirmar_entrega', { p_shipment_id: sh.id, p_proof_path: null, p_received_by: recibioSegunPaqueteria(res, 't1') })
              cierre = ceErr ? 'pendiente' : 'cerrado'
            } else if (res.estado === 'entregado') cierre = 'pendiente'
          }
        } catch (e) {
          obs('sync_tracking', 'provider_error', { code: 'red', mensaje: 'sin respuesta de T1 en rastreo', error: e })
          await admin.rpc('registrar_rastreo', { p_shipment: sh.id, p_provider: proveedor, p_estado: null, p_error: 'sin respuesta de la paquetería' })
        }
      } else if (proveedor !== 'dhl') {
        aviso = 'El rastreo automático aún no está disponible para esta paquetería.'
      } else {
        const user = Deno.env.get('DHL_API_USERNAME'), pass = Deno.env.get('DHL_API_PASSWORD')
        if (!user || !pass) return json(501, { error: 'not_configured', message: 'DHL no habilitado.' })
        const base = dhlBaseUrl(Deno.env.get('DHL_API_ENV'))
        try {
          const r = await fetch(`${base}/shipments/${encodeURIComponent(s(sh.tracking_number))}/tracking`, { headers: { Authorization: 'Basic ' + btoa(`${user}:${pass}`) } })
          const data = await r.json().catch(() => ({}))
          if (!r.ok && !isTrackingNoData(r.status, data)) {
            obs('sync_tracking', 'provider_error', { code: r.status, mensaje: 'DHL respondió error en rastreo' })
            await admin.rpc('registrar_rastreo', { p_shipment: sh.id, p_provider: proveedor, p_estado: null, p_error: `DHL ${r.status}` })
            aviso = 'La paquetería no respondió; se muestra lo último conocido.'
          } else {
            const res = r.ok ? resumenDhl(data) : resumenDhl({})
            const { error: regErr } = await admin.rpc('registrar_rastreo', {
              p_shipment: sh.id, p_provider: proveedor, p_estado: res.estado, p_descripcion: res.descripcion,
              p_firmado_por: res.firmadoPor, p_entregado_at: res.entregadoAt, p_eventos: res.eventos,
            })
            if (regErr) return json(500, { error: 'No se pudo guardar el rastreo.' })
            consultado = true
            // La paquetería confirmó la entrega: se cierra con el comando de siempre (confirmar_entrega) y la identidad
            // de quien sincroniza. Solo logística puede cerrar; si quien mira es el cliente, queda anotado y se cierra
            // cuando logística sincronice.
            if (res.estado === 'entregado') {
              if (esLogistica) {
                const { error: cErr } = await caller.rpc('confirmar_entrega', { p_shipment_id: sh.id, p_proof_path: null, p_received_by: recibioSegunPaqueteria(res, proveedor) })
                cierre = cErr ? 'pendiente' : 'cerrado'
              } else cierre = 'pendiente'
            }
          }
        } catch (_e) {
          obs('sync_tracking', 'provider_error', { code: 'red', mensaje: 'sin respuesta de DHL en rastreo' })
          await admin.rpc('registrar_rastreo', { p_shipment: sh.id, p_provider: proveedor, p_estado: null, p_error: 'sin respuesta de la paquetería' })
          aviso = 'La paquetería no respondió; se muestra lo último conocido.'
        }
      }
    }
    const { data: tr } = await admin.from('shipment_tracking').select('estado, descripcion, firmado_por, entregado_at, ultimo_evento_at, synced_at').eq('shipment_id', sh.id).maybeSingle()
    const { data: evs } = await admin.from('shipment_tracking_events').select('ocurrido_at, codigo, descripcion, lugar').eq('shipment_id', sh.id).order('ocurrido_at', { ascending: false }).limit(60)
    return json(200, { shipment_id: sh.id, tracking: sh.tracking_number, carrier: sh.carrier, consultado, cierre, aviso, rastreo: tr ?? null, eventos: evs ?? [] })
  }

  if (!esLogistica) return json(403, { error: 'Solo staff de logística puede cotizar o generar guías.' })

  // ===================== PAQ-A · ETIQUETA DE UNA GUÍA EXISTENTE (reimpresión) =====================
  // Solo logística. No llama a la paquetería ni valida destinatario/paquete: la guía ya existe; se firma de nuevo el
  // enlace del PDF guardado (1 h). Antes solo se podía bajar en el momento de generarla.
  if (action === 'get_label') {
    const orderId = s(p.order_id)
    if (!orderId) return json(400, { error: 'Falta order_id.' })
    const { data: sh, error: shErr } = await admin.from('shipments')
      .select('tracking_number, label_path, carrier, service_code, estimated_delivery_at, provider_cost, currency')
      .eq('order_id', orderId).not('tracking_number', 'is', null).limit(1).maybeSingle()
    if (shErr) return json(500, { error: 'No se pudo leer el envío.' })
    if (!sh?.tracking_number) return json(404, { error: 'sin_guia', message: 'Ese pedido no tiene una guía de paquetería.' })
    if (!sh.label_path) return json(404, { error: 'sin_etiqueta', message: 'Esa guía no tiene una etiqueta guardada.' })
    const label = await labelPayload(admin, sh)
    if (!label.labelUrl) return json(500, { error: 'No se pudo firmar el enlace de la etiqueta.' })
    return json(200, { idempotent: true, label })
  }

  // ===================== PAQ-B · RECOLECCIÓN (agendar / cancelar que la paquetería pase) =====================
  // Solo logística. La guía ya existe; se usa el paquete, el servicio y el origen con los que se generó (del servidor).
  // La confirmación queda en el envío (pickup_confirmation + provider_meta.pickup). Una recolección por guía.
  if (action === 'schedule_pickup' || action === 'cancel_pickup') {
    const orderId = s(p.order_id)
    if (!orderId) return json(400, { error: 'Falta order_id.' })
    const { data: sh, error: shErr } = await admin.from('shipments')
      .select('id, tracking_number, provider, status, service_code, package, ship_from, pickup_confirmation, provider_meta')
      .eq('order_id', orderId).not('tracking_number', 'is', null).limit(1).maybeSingle()
    if (shErr) return json(500, { error: 'No se pudo leer el envío.' })
    if (!sh?.tracking_number) return json(404, { error: 'sin_guia', message: 'Ese pedido no tiene una guía de paquetería.' })
    if (sh.status === 'delivered' || sh.status === 'cancelado') return json(409, { error: 'envio_cerrado', message: 'Ese envío ya está cerrado.' })
    if ((s(sh.provider) || 'dhl') === 't1') {
      // T1 · POST /pickup/create con la paquetería de la guía; T1 no documenta cancelación → se avisa tal cual.
      if (action === 'cancel_pickup') return json(422, { error: 'proveedor_sin_cancelacion', message: 'T1 no permite cancelar la recolección desde el sistema; cancélala en t1envios.com.' })
      const cfg = t1Config(Deno.env.get)
      if (!cfg) return json(501, { error: 'not_configured', message: 'T1 no habilitado.' })
      // deno-lint-ignore no-explicit-any
      const metaT1 = ((sh.provider_meta ?? {}) as Record<string, any>)
      const vigenteT1 = s(sh.pickup_confirmation)
      if (vigenteT1) return json(200, { idempotent: true, pickup: metaT1.pickup ?? { confirmation: vigenteT1 } })
      const { hoy, ahoraMin } = ahoraLocalOrigen(Date.now())
      const pedido = limpiarRecoleccion(p.pickup as RecoleccionSolicitada)
      const errRec = errorRecoleccion(pedido, hoy, ahoraMin)
      if (errRec) return json(422, { error: 'recoleccion_invalida', message: errRec })
      // Mismo origen y paquete con que se generó la guía (guardados en el envío); si no, el de la empresa.
      const shipper = (sh.ship_from as NeutralShipper | null) ?? (await companyShipper(admin)).shipper
      const pkgT1 = (sh.package as NeutralPackage | null) ?? { weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10, pieces: 1 }
      const mensajeria = s(metaT1.paqueteria) || s(sh.service_code).split('|')[0] || 'DHL'
      try {
        const tk = await t1Token(cfg)
        const r = await fetch(`${cfg.base}/pickup/create`, { method: 'POST', headers: cabecerasT1(cfg, tk), body: JSON.stringify(buildPickupT1(shipper, pkgT1, mensajeria, { date: pedido.date, ready: pedido.ready, close: pedido.close, instructions: pedido.instructions }, cfg.comercioId, Deno.env.get('T1_ORIGEN_COLONIA'))) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok || d?.success === false) { obs('schedule_pickup', 'provider_error', { code: r.status, mensaje: 'T1 respondió error al agendar la recolección' }); return json(502, { error: t1ErrorMessage(r.status, d) }) }
        const { confirmation } = parsePickupT1(d)
        if (!confirmation) { obs('schedule_pickup', 'provider_error', { code: 'sin_confirmacion', mensaje: 'T1 2xx sin pick_up' }); return json(502, { error: 'T1 no devolvió número de recolección.' }) }
        const pickup = { confirmation, date: pedido.date, ready: pedido.ready, close: pedido.close, location: pedido.location, instructions: pedido.instructions ?? null, mensajeria, agendada_at: new Date().toISOString() }
        const { error: upErr } = await caller.from('shipments').update({ pickup_confirmation: confirmation, provider_meta: { ...metaT1, pickup } }).eq('id', sh.id)
        if (upErr) return json(500, { error: 'no_guardada', message: `T1 agendó la recolección ${confirmation} pero no se pudo guardar. Anótala.` })
        return json(200, { pickup })
      } catch (e) {
        obs('schedule_pickup', 'unknown', { code: 'red', error: e })
        return json(504, { error: 'resultado_desconocido', message: 'T1 no respondió. Puede que la recolección SÍ haya quedado agendada: confírmalo en t1envios.com antes de volver a intentar.' })
      }
    }
    if ((s(sh.provider) || 'dhl') !== 'dhl') return json(422, { error: 'proveedor_sin_recoleccion', message: 'La recolección desde el sistema aún no está disponible para esta paquetería.' })
    const user = Deno.env.get('DHL_API_USERNAME'), pass = Deno.env.get('DHL_API_PASSWORD'), account = Deno.env.get('DHL_ACCOUNT_NUMBER')
    if (!user || !pass || !account) return json(501, { error: 'not_configured', message: 'DHL no habilitado.' })
    const base = dhlBaseUrl(Deno.env.get('DHL_API_ENV'))
    const H = { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(`${user}:${pass}`) }
    // deno-lint-ignore no-explicit-any
    const meta = ((sh.provider_meta ?? {}) as Record<string, any>)
    const vigente = s(sh.pickup_confirmation)

    if (action === 'schedule_pickup') {
      if (vigente) return json(200, { idempotent: true, pickup: meta.pickup ?? { confirmation: vigente } })
      const { hoy, ahoraMin } = ahoraLocalOrigen(Date.now())
      const pedida = p.pickup as RecoleccionSolicitada
      const motivo = errorRecoleccion(pedida, hoy, ahoraMin)
      if (motivo) return json(422, { error: 'recoleccion_invalida', message: motivo })
      const rec = limpiarRecoleccion(pedida)
      const pkg = sh.package as NeutralPackage | null
      if (!pkg || !(Number(pkg.weightKg) > 0)) return json(422, { error: 'sin_paquete', message: 'El envío no tiene guardadas las medidas del paquete; no se puede agendar la recolección desde aquí.' })
      const shipper = (sh.ship_from as NeutralShipper | null) ?? (await companyShipper(admin)).shipper
      let data: unknown = {}
      try {
        const r = await fetch(`${base}/pickups`, { method: 'POST', headers: H, body: JSON.stringify(buildPickupRequest(shipper, pkg, account, s(sh.service_code) || 'N', rec)) })
        data = await r.json().catch(() => ({}))
        if (!r.ok) { obs('schedule_pickup', 'provider_error', { code: r.status, mensaje: 'DHL respondió error al agendar la recolección' }); return json(502, { error: 'proveedor', message: dhlErrorMessage(r.status, data) }) }
      } catch (_e) {
        obs('schedule_pickup', 'unknown', { code: 'red', mensaje: 'sin respuesta de DHL al agendar la recolección' })
        return json(504, { error: 'resultado_desconocido', message: 'DHL no respondió. Puede que la recolección SÍ haya quedado agendada: confírmalo con DHL antes de volver a intentar.' })
      }
      const { confirmation } = parsePickup(data)
      if (!confirmation) { obs('schedule_pickup', 'unknown', { code: 'sin_confirmacion', mensaje: 'DHL 2xx sin número de confirmación' }); return json(502, { error: 'sin_confirmacion', message: 'DHL aceptó la solicitud pero no devolvió número de confirmación. Confírmalo con DHL.' }) }
      const pickup = { confirmation, ...rec, requested_by: who.user.id, requested_at: new Date().toISOString() }
      // Se escribe con la identidad de quien agenda (logística): es lo que admite el candado de envíos.
      const { error: upErr } = await caller.from('shipments').update({ pickup_confirmation: confirmation, provider_meta: { ...meta, pickup } }).eq('id', sh.id)
      if (upErr) { obs('schedule_pickup', 'internal_error', { code: 'guardar', mensaje: 'recolección agendada en DHL pero no guardada' }); return json(500, { error: 'no_guardada', message: `DHL agendó la recolección (confirmación ${confirmation}) pero no se pudo guardar en el sistema. Anota ese número.`, pickup }) }
      return json(200, { pickup })
    }

    // cancel_pickup
    if (!vigente) return json(404, { error: 'sin_recoleccion', message: 'Esa guía no tiene una recolección agendada.' })
    const motivoCancel = s(p.reason).slice(0, 80) || 'Cancelada por el remitente'
    const quienPide = (s(q.quien.full_name) || 'Renovacell').slice(0, 45)
    try {
      const r = await fetch(`${base}/pickups/${encodeURIComponent(vigente)}?requestorName=${encodeURIComponent(quienPide)}&reason=${encodeURIComponent(motivoCancel)}`, { method: 'DELETE', headers: H })
      if (!r.ok) { const d = await r.json().catch(() => ({})); obs('cancel_pickup', 'provider_error', { code: r.status, mensaje: 'DHL respondió error al cancelar la recolección' }); return json(502, { error: 'proveedor', message: dhlErrorMessage(r.status, d) }) }
    } catch (_e) {
      obs('cancel_pickup', 'unknown', { code: 'red', mensaje: 'sin respuesta de DHL al cancelar la recolección' })
      return json(504, { error: 'resultado_desconocido', message: 'DHL no respondió. Confirma con DHL si la recolección quedó cancelada.' })
    }
    const pickupAnterior = { ...(meta.pickup ?? {}), cancelled_by: who.user.id, cancelled_at: new Date().toISOString(), cancel_reason: motivoCancel }
    const { error: upErr } = await caller.from('shipments').update({ pickup_confirmation: null, provider_meta: { ...meta, pickup: null, pickup_cancelada: pickupAnterior } }).eq('id', sh.id)
    if (upErr) return json(500, { error: 'no_guardada', message: 'DHL canceló la recolección pero no se pudo actualizar el sistema. Vuelve a intentar.' })
    return json(200, { cancelled: true })
  }

  // ===================== PROVIDER T1 ENVÍOS (acciones neutras, `provider: 't1'`) =====================
  // Mismo contrato que DHL: cotizar → el cliente elige SERVICIO (serviceCode "PAQUETERIA|SERVICIO") → el servidor re-cotiza
  // (precio y token de T1 autoritativos) → guía con token_quote → etiqueta al bucket privado → finalize_shipment atómico.
  if (action === 'rate' || action === 'create_shipment' || action === 'track') if (s(p.provider) === 't1') {
    const cfg = t1Config(Deno.env.get)
    if (!cfg) return json(501, { error: 'not_configured', message: `T1 no habilitado. Carga ${T1_SECRETOS.join(', ')}.` })
    try {
      const tk = await t1Token(cfg)
      const H = cabecerasT1(cfg, tk)
      if (action === 'track') {
        const tn = s(p.tracking)
        if (!tn) return json(400, { error: 'Falta tracking.' })
        const r = await fetch(`${cfg.base}/webhook-maestro/query/estado-guia/${encodeURIComponent(tn)}`, { headers: H })
        const data = await r.json().catch(() => ({}))
        if (!r.ok) { if (r.status === 400 || r.status === 404) return json(200, emptyTrackingResult(tn)); obs('track', 'provider_error', { code: r.status, mensaje: 'T1 respondió error en rastreo' }); return json(502, { error: t1ErrorMessage(r.status, data) }) }
        return json(200, { tracking: tn, ...parseTrackingT1(data) })
      }
      const { shipper, missing: originMiss } = await companyShipper(admin)
      if (originMiss.length) return json(422, { error: 'shipping_origin_not_configured', message: 'Configura el origen de envíos en Configuración antes de operar paquetería.', missing: originMiss })
      const receiver = p.receiver as NeutralReceiver
      const pkg = p.pkg as NeutralPackage
      const miss = missingReceiverPkg(receiver, pkg)
      if (miss.length) return json(422, { error: 'missing_data', missing: miss })
      const cotizar = async () => {
        const r = await fetch(`${cfg.base}/quote/create`, { method: 'POST', headers: H, body: JSON.stringify(buildQuoteT1(shipper, receiver, pkg, cfg.comercioId)) })
        const data = await r.json().catch(() => ({}))
        return { ok: r.ok && data?.success !== false, status: r.status, data, rates: parseQuoteT1(data) }
      }
      if (action === 'rate') {
        const q = await cotizar()
        if (!q.ok) { obs('rate', 'provider_error', { code: q.status, mensaje: 'T1 respondió error en cotización' }); return json(502, { error: t1ErrorMessage(q.status, q.data) }) }
        if (!q.rates.length) { obs('rate', 'provider_error', { code: 'sin_tarifas', mensaje: 'T1 no devolvió tarifas' }); return json(502, { error: 'T1 no devolvió tarifas para estos datos.' }) }
        // El token de cada servicio se queda en el servidor: el cliente solo ve y elige el servicio.
        return json(200, { rates: q.rates.map(({ token: _t, ...r }) => ({ ...r, provider: 't1' })) })
      }
      // create_shipment
      const orderId = s(p.order_id)
      const orderRef = s(p.orderRef) || orderId
      const serviceCode = s(p.rate?.serviceCode) || s(p.serviceCode)
      const idemKey = s(p.idempotencyKey) || `${orderId}:${serviceCode}`
      if (!orderId) return json(400, { error: 'Falta order_id.' })
      if (!serviceCode) return json(400, { error: 'Falta el servicio (elige una tarifa).' })
      const { data: existing } = await admin.from('shipments')
        .select('tracking_number, label_path, carrier, service_code, estimated_delivery_at, provider_cost, currency, provider')
        .eq('order_id', orderId).not('tracking_number', 'is', null).limit(1).maybeSingle()
      if (existing?.tracking_number) return json(200, { idempotent: true, label: await labelPayload(admin, existing) })
      const { data: active } = await admin.from('shipping_attempts')
        .select('status').eq('order_id', orderId).in('status', ['pending', 'succeeded', 'unknown_requires_reconciliation']).limit(1).maybeSingle()
      if (active?.status === 'unknown_requires_reconciliation') return json(409, { error: 'unknown_requires_reconciliation', message: 'Un intento anterior quedó en estado desconocido; requiere reconciliación antes de reintentar.' })
      if (active?.status === 'pending') return json(409, { error: 'in_progress', message: 'Ya hay una guía en proceso para este pedido.' })
      const { data: cancelacion } = await admin.from('order_cancel_requests').select('id').eq('order_id', orderId).eq('status', 'pendiente').limit(1).maybeSingle()
      if (cancelacion) return json(409, { error: 'cancelacion_solicitada', message: 'Este pedido tiene una cancelación por resolver. Dirección decide antes de generar la guía.' })
      const fingerprint = await sha256Hex(JSON.stringify({ shipper, receiver, pkg, serviceCode, provider: 't1' }))
      const msgRef = `${orderId}-${idemKey}`.slice(0, 36)
      const { data: claim, error: claimErr } = await admin.from('shipping_attempts')
        .insert({ order_id: orderId, provider: 't1', idempotency_key: idemKey, service_code: serviceCode, request_fingerprint: fingerprint, external_reference: msgRef, status: 'pending' })
        .select('id').single()
      if (claimErr || !claim) return json(409, { error: 'in_progress', message: 'Otra solicitud está creando la guía de este pedido.' })
      const attemptId = claim.id as string
      // Re-cotización server-side: el token de T1 se obtiene aquí; el precio es el del servidor.
      let serverRate: ReturnType<typeof parseQuoteT1>[number] | undefined
      try {
        const q = await cotizar()
        if (!q.ok) { obs('create_shipment', 'provider_error', { code: q.status, mensaje: 'T1 respondió error en cotización previa a la guía' }); await failAttempt(admin, attemptId, t1ErrorMessage(q.status, q.data)); return json(502, { error: t1ErrorMessage(q.status, q.data) }) }
        serverRate = q.rates.find((x) => x.serviceCode === serviceCode)
      } catch (e) {
        obs('create_shipment', 'provider_error', { code: 'rate_exception', error: e })
        await failAttempt(admin, attemptId, `rate: ${(e as Error).message}`)
        return json(502, { error: `Error con T1 (cotización): ${(e as Error).message}` })
      }
      if (!serverRate) { await failAttempt(admin, attemptId, 'service_not_available'); return json(422, { error: 'service_not_available', message: 'El servicio elegido ya no está disponible para estos datos. Vuelve a cotizar.' }) }
      let shipResp: Response
      try {
        shipResp = await fetch(`${cfg.base}/guide/create`, { method: 'POST', headers: H, body: JSON.stringify(buildGuideT1(shipper, receiver, serverRate.token, orderRef, cfg.comercioId, Deno.env.get('T1_ORIGEN_COLONIA'))) })
      } catch (e) {
        obs('create_shipment', 'unknown', { code: 'create_timeout', error: e })
        await markUnknown(admin, attemptId, `create timeout/network: ${(e as Error).message}`)
        return json(409, { error: 'unknown_requires_reconciliation', message: 'No se pudo confirmar el resultado con T1; la guía pudo crearse. Requiere reconciliación (no se reintenta automáticamente).' })
      }
      const shipData = await shipResp.json().catch(() => ({}))
      if (!shipResp.ok || shipData?.success === false) { obs('create_shipment', 'provider_error', { code: shipResp.status, mensaje: 'T1 rechazó la creación de la guía' }); await failAttempt(admin, attemptId, t1ErrorMessage(shipResp.status, shipData)); return json(502, { error: t1ErrorMessage(shipResp.status, shipData) }) }
      const g = parseGuideT1(shipData)
      if (!g.tracking) { obs('create_shipment', 'unknown', { code: 'sin_tracking', mensaje: 'T1 2xx sin guía' }); await markUnknown(admin, attemptId, 'T1 2xx sin guía'); return json(409, { error: 'unknown_requires_reconciliation', message: 'T1 respondió sin número de guía; requiere reconciliación.' }) }
      const amount = g.cost ?? serverRate.amount
      const etaDays = Number(serverRate.etaDays ?? 2)
      const estimatedDeliveryAt = new Date(Date.now() + etaDays * 86_400_000).toISOString()
      await admin.from('shipping_attempts').update({ tracking_number: g.tracking, provider_cost: amount, currency: serverRate.currency, quote_ref: serviceCode, updated_at: new Date().toISOString() }).eq('id', attemptId)
      let labelPath: string | null = null
      if (g.labelBase64) {
        try {
          const bytes = Uint8Array.from(atob(g.labelBase64), (c) => c.charCodeAt(0))
          const path = `${orderId}/${g.tracking}.pdf`
          const { error: upErr } = await admin.storage.from(LABELS_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true })
          if (!upErr) labelPath = path
        } catch { /* etiqueta recuperable después (link_guia); no bloquea ni recompra */ }
      }
      const carrier = g.carrier || serverRate.carrier
      const shipmentRow = {
        order_id: orderId, carrier, tracking_number: g.tracking, status: 'in_transit',
        estimated_delivery_at: estimatedDeliveryAt, provider: 't1', service_code: serviceCode,
        label_path: labelPath, label_url: labelPath ? null : g.labelUrl, package: pkg, ship_from: shipper, ship_to: receiver,
        provider_meta: { trackingNumber: g.tracking, labelFormat: 'PDF', paqueteria: serviceCode.split('|')[0], servicio: serverRate.service, num_orden: g.numOrden, link_guia: g.labelUrl }, provider_cost: amount,
        currency: serverRate.currency, quote_ref: serviceCode,
      }
      const { error: finErr } = await admin.rpc('finalize_shipment', { p_attempt_id: attemptId, p_shipment: shipmentRow as unknown as never })
      if (finErr) { obs('create_shipment', 'unknown', { code: 'finalize_failed', error: finErr }); await markUnknown(admin, attemptId, `finalize: ${finErr.message}`); return json(409, { error: 'unknown_requires_reconciliation', message: 'La guía de T1 existe pero no se pudo registrar; requiere reconciliación (no se reintenta automáticamente).' }) }
      let labelUrl = g.labelUrl ?? ''
      if (labelPath) { const { data: sg } = await admin.storage.from(LABELS_BUCKET).createSignedUrl(labelPath, SIGNED_TTL); labelUrl = sg?.signedUrl ?? labelUrl }
      return json(200, { label: { provider: 't1', carrier, service: serverRate.service, serviceCode, tracking: g.tracking, labelUrl, amount, currency: serverRate.currency, etaDays, estimatedDeliveryAt } })
    } catch (e) {
      obs('t1', 'provider_error', { code: 'exception', error: e })
      return json(502, { error: `Error con T1: ${(e as Error).message}` })
    }
  }

  // ===================== PROVIDER DHL (acciones neutras) =====================
  if (action === 'rate' || action === 'create_shipment' || action === 'track') {
    const user = Deno.env.get('DHL_API_USERNAME')
    const pass = Deno.env.get('DHL_API_PASSWORD')
    const account = Deno.env.get('DHL_ACCOUNT_NUMBER')
    if (!user || !pass || !account) return json(501, { error: 'not_configured', message: 'DHL no habilitado. Carga DHL_API_USERNAME/PASSWORD/ACCOUNT_NUMBER.' })
    const base = dhlBaseUrl(Deno.env.get('DHL_API_ENV'))
    const authz = 'Basic ' + btoa(`${user}:${pass}`)
    const H = { 'Content-Type': 'application/json', Authorization: authz }

    try {
      if (action === 'track') {
        const tn = s(p.tracking)
        if (!tn) return json(400, { error: 'Falta tracking.' })
        const r = await fetch(`${base}/shipments/${encodeURIComponent(tn)}/tracking`, { headers: { Authorization: authz } })
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          // Guía válida sin eventos todavía (404 / "No data found") → éxito de dominio,
          // no error. Auth (401/403), request inválido (400) y otros 5xx SIGUEN siendo error.
          if (isTrackingNoData(r.status, data)) return json(200, emptyTrackingResult(tn))
          obs('track', 'provider_error', { code: r.status, mensaje: 'DHL respondió error en rastreo' })
          return json(502, { error: dhlErrorMessage(r.status, data) })
        }
        return json(200, { tracking: tn, ...parseTracking(data) })
      }

      // ORIGEN server-side (autoridad + gate go-live). NUNCA se confía el shipper del cliente.
      const { shipper, missing: originMiss } = await companyShipper(admin)
      if (originMiss.length) return json(422, { error: 'shipping_origin_not_configured', message: 'Configura el origen de envíos en Configuración antes de operar paquetería.', missing: originMiss })

      const receiver = p.receiver as NeutralReceiver
      const pkg = p.pkg as NeutralPackage
      const miss = missingReceiverPkg(receiver, pkg)
      if (miss.length) return json(422, { error: 'missing_data', missing: miss })

      if (action === 'rate') {
        const r = await fetch(`${base}/rates`, { method: 'POST', headers: H, body: JSON.stringify(buildRateRequest(shipper, receiver, pkg, account)) })
        const data = await r.json().catch(() => ({}))
        if (!r.ok) { obs('rate', 'provider_error', { code: r.status, mensaje: 'DHL respondió error en cotización' }); return json(502, { error: dhlErrorMessage(r.status, data) }) }
        const rates = parseRates(data)
        if (!rates.length) { obs('rate', 'provider_error', { code: 'sin_tarifas', mensaje: 'DHL no devolvió tarifas' }); return json(502, { error: 'DHL no devolvió tarifas para estos datos.' }) }
        return json(200, { rates })
      }

      // ================= create_shipment (P0: anti-doble-guía + precio autoritativo) =================
      const orderId = s(p.order_id)
      const orderRef = s(p.orderRef) || orderId
      const productCode = s(p.rate?.serviceCode) || s(p.serviceCode) // el cliente SOLO elige servicio
      const idemKey = s(p.idempotencyKey) || `${orderId}:${productCode}`
      if (!orderId) return json(400, { error: 'Falta order_id.' })
      if (!productCode) return json(400, { error: 'Falta el código de servicio (elige una tarifa).' })

      // 0) Guía existente → idempotente (0 llamadas a DHL).
      const { data: existing } = await admin.from('shipments')
        .select('tracking_number, label_path, carrier, service_code, estimated_delivery_at, provider_cost, currency')
        .eq('order_id', orderId).not('tracking_number', 'is', null).limit(1).maybeSingle()
      if (existing?.tracking_number) return json(200, { idempotent: true, label: await labelPayload(admin, existing) })

      // 1) Intento activo/desconocido previo → NO recomprar.
      const { data: active } = await admin.from('shipping_attempts')
        .select('status').eq('order_id', orderId).in('status', ['pending', 'succeeded', 'unknown_requires_reconciliation']).limit(1).maybeSingle()
      if (active?.status === 'unknown_requires_reconciliation')
        return json(409, { error: 'unknown_requires_reconciliation', message: 'Un intento anterior quedó en estado desconocido; requiere reconciliación antes de reintentar.' })
      if (active?.status === 'pending')
        return json(409, { error: 'in_progress', message: 'Ya hay una guía en proceso para este pedido.' })

      // 1b) Cancelación solicitada → Dirección decide antes de enviar (la base también lo bloquea al crear el intento).
      const { data: cancelacion } = await admin.from('order_cancel_requests').select('id').eq('order_id', orderId).eq('status', 'pendiente').limit(1).maybeSingle()
      if (cancelacion) return json(409, { error: 'cancelacion_solicitada', message: 'Este pedido tiene una cancelación por resolver. Dirección decide antes de generar la guía.' })

      // 2) CLAIM durable PRE-proveedor con exclusión real (índice único parcial). Carrera → 23505.
      const fingerprint = await sha256Hex(JSON.stringify({ shipper, receiver, pkg, productCode }))
      const msgRef = `${orderId}-${idemKey}`.slice(0, 36)
      const { data: claim, error: claimErr } = await admin.from('shipping_attempts')
        .insert({ order_id: orderId, provider: 'dhl', idempotency_key: idemKey, service_code: productCode, request_fingerprint: fingerprint, external_reference: msgRef, status: 'pending' })
        .select('id').single()
      if (claimErr || !claim) return json(409, { error: 'in_progress', message: 'Otra solicitud está creando la guía de este pedido.' })
      const attemptId = claim.id as string

      // 3) RE-COTIZACIÓN server-side = AUTORIDAD del precio/servicio/ETA (liga el precio al paquete real;
      //    ignora cualquier amount/etaDays del cliente). Falla aquí = solo cotización → safe retry.
      let serverRate: { id: string; service: string; serviceCode?: string; amount: number; currency: string; etaDays: number } | undefined
      try {
        const rq = await fetch(`${base}/rates`, { method: 'POST', headers: H, body: JSON.stringify(buildRateRequest(shipper, receiver, pkg, account)) })
        const rd = await rq.json().catch(() => ({}))
        if (!rq.ok) { obs('create_shipment', 'provider_error', { code: rq.status, mensaje: 'DHL respondió error en cotización previa a la guía' }); await failAttempt(admin, attemptId, dhlErrorMessage(rq.status, rd)); return json(502, { error: dhlErrorMessage(rq.status, rd) }) }
        serverRate = parseRates(rd).find((x) => String(x.serviceCode) === productCode)
      } catch (e) {
        obs('create_shipment', 'provider_error', { code: 'rate_exception', error: e })
        await failAttempt(admin, attemptId, `rate: ${(e as Error).message}`)
        return json(502, { error: `Error con DHL (cotización): ${(e as Error).message}` })
      }
      if (!serverRate) { await failAttempt(admin, attemptId, 'service_not_available'); return json(422, { error: 'service_not_available', message: 'El servicio elegido ya no está disponible para estos datos. Vuelve a cotizar.' }) }

      // 4) CREAR GUÍA. Excepción durante el POST = resultado DESCONOCIDO (no se prueba que DHL no la
      //    creó) → unknown_requires_reconciliation, SIN retry automático (preferible bloquear a duplicar).
      let shipResp: Response
      try {
        shipResp = await fetch(`${base}/shipments`, { method: 'POST', headers: { ...H, 'Message-Reference': msgRef }, body: JSON.stringify(buildShipmentRequest(shipper, receiver, pkg, account, productCode, orderRef)) })
      } catch (e) {
        obs('create_shipment', 'unknown', { code: 'create_timeout', error: e })
        await markUnknown(admin, attemptId, `create timeout/network: ${(e as Error).message}`)
        return json(409, { error: 'unknown_requires_reconciliation', message: 'No se pudo confirmar el resultado con DHL; la guía pudo crearse. Requiere reconciliación (no se reintenta automáticamente).' })
      }
      const shipData = await shipResp.json().catch(() => ({}))
      if (!shipResp.ok) { obs('create_shipment', 'provider_error', { code: shipResp.status, mensaje: 'DHL rechazó la creación de la guía' }); await failAttempt(admin, attemptId, dhlErrorMessage(shipResp.status, shipData)); return json(502, { error: dhlErrorMessage(shipResp.status, shipData) }) }
      const { tracking, labelBase64, labelFormat } = parseShipment(shipData)
      if (!tracking) { obs('create_shipment', 'unknown', { code: 'sin_tracking', mensaje: 'DHL 2xx sin tracking' }); await markUnknown(admin, attemptId, 'DHL 2xx sin tracking'); return json(409, { error: 'unknown_requires_reconciliation', message: 'DHL respondió sin número de guía; requiere reconciliación.' }) }

      // 5) Evidencia inmediata (tracking + costo del SERVIDOR) en el intento, antes de finalizar.
      const etaDays = Number(serverRate.etaDays ?? 2)
      const estimatedDeliveryAt = new Date(Date.now() + etaDays * 86_400_000).toISOString()
      const quoteRef = String(serverRate.id ?? productCode)
      await admin.from('shipping_attempts').update({ tracking_number: tracking, provider_cost: serverRate.amount, currency: serverRate.currency, quote_ref: quoteRef, updated_at: new Date().toISOString() }).eq('id', attemptId)

      // 6) Etiqueta → Storage privado (best-effort; su fallo NO recompra ni invalida la guía).
      let labelPath: string | null = null
      if (labelBase64) {
        try {
          const bytes = Uint8Array.from(atob(labelBase64), (c) => c.charCodeAt(0))
          const path = `${orderId}/${tracking}.${labelFormat.toLowerCase() === 'zpl' ? 'zpl' : 'pdf'}`
          const { error: upErr } = await admin.storage.from(LABELS_BUCKET).upload(path, bytes, { contentType: labelFormat.toLowerCase() === 'zpl' ? 'application/octet-stream' : 'application/pdf', upsert: true })
          if (!upErr) labelPath = path
        } catch { /* etiqueta recuperable después; no bloquea ni recompra */ }
      }

      // 7) FINALIZE ATÓMICO: shipment + cierre del intento en una transacción. Falla = la guía EXISTE
      //    (tracking ya guardado) → reconciliación, nunca recompra.
      const shipmentRow = {
        order_id: orderId, carrier: 'DHL', tracking_number: tracking, status: 'in_transit',
        estimated_delivery_at: estimatedDeliveryAt, provider: 'dhl', service_code: productCode,
        label_path: labelPath, package: pkg, ship_from: shipper, ship_to: receiver,
        provider_meta: { trackingNumber: tracking, labelFormat }, provider_cost: serverRate.amount,
        currency: serverRate.currency, quote_ref: quoteRef,
      }
      const { error: finErr } = await admin.rpc('finalize_shipment', { p_attempt_id: attemptId, p_shipment: shipmentRow as unknown as never })
      if (finErr) { obs('create_shipment', 'unknown', { code: 'finalize_failed', error: finErr }); await markUnknown(admin, attemptId, `finalize: ${finErr.message}`); return json(409, { error: 'unknown_requires_reconciliation', message: 'La guía se creó en DHL pero falló el guardado local; requiere reconciliación (no se reintenta automáticamente).' }) }

      let labelUrl = ''
      if (labelPath) { const { data: sg } = await admin.storage.from(LABELS_BUCKET).createSignedUrl(labelPath, SIGNED_TTL); labelUrl = sg?.signedUrl ?? '' }
      return json(200, { label: { provider: 'dhl', carrier: 'DHL', service: serverRate.service ?? 'DHL Express', serviceCode: productCode, tracking, labelUrl, amount: serverRate.amount, currency: serverRate.currency, etaDays, estimatedDeliveryAt } })
    } catch (e) {
      obs('dhl', 'provider_error', { code: 'exception', error: e })
      return json(502, { error: `Error con DHL: ${(e as Error).message}` })
    }
  }

  // ============ PROVIDER LEGADO (agregador Envia/mock) — intacto ============
  const key = Deno.env.get('SHIPPING_API_KEY')
  if (!key) return json(501, { error: 'not_configured', message: 'Paquetería no habilitada. Agrega SHIPPING_API_KEY o credenciales DHL.' })
  const legacyBase = (Deno.env.get('SHIPPING_API_URL') ?? 'https://api.envia.com').replace(/\/$/, '')
  const ratePath = Deno.env.get('SHIPPING_RATE_PATH') ?? '/ship/rate/'
  const labelPath = Deno.env.get('SHIPPING_LABEL_PATH') ?? '/ship/generate/'
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
  const norm = (str: string): string => str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
  // deno-lint-ignore no-explicit-any
  function pick(o: any, cands: string[]): string | undefined {
    if (!o || typeof o !== 'object') return undefined
    for (const k of Object.keys(o)) { const nk = norm(k); if (cands.some((c) => nk === norm(c) || nk.includes(norm(c))) && (typeof o[k] === 'string' || typeof o[k] === 'number')) return String(o[k]) }
    return undefined
  }
  // deno-lint-ignore no-explicit-any
  const addr = (a: any) => ({ name: a.name, street: a.street, city: a.city, state: a.state, country: 'MX', postalCode: a.zip, phone: a.phone })
  // deno-lint-ignore no-explicit-any
  const buildLegacy = (o: any, d: any, parcel: any, carrier?: string) => ({ origin: addr(o), destination: addr(d), packages: [{ content: 'Producto', amount: 1, type: 'box', weight: parcel.weightKg, weightUnit: 'KG', lengthUnit: 'CM', dimensions: { length: parcel.lengthCm, width: parcel.widthCm, height: parcel.heightCm } }], shipment: carrier ? { carrier, type: 1 } : { type: 1 } })
  try {
    if (action === 'quote') {
      const r = await fetch(legacyBase + ratePath, { method: 'POST', headers, body: JSON.stringify(buildLegacy(p.origin, p.destination, p.parcel)) })
      const data = await r.json().catch(() => ({}))
      // deno-lint-ignore no-explicit-any
      const rows: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
      const rates = rows.map((x, i) => ({ id: String(pick(x, ['rateid', 'id']) ?? `${pick(x, ['carrier']) ?? 'rate'}-${i}`), carrier: pick(x, ['carrier', 'carriername', 'provider']) ?? 'Paquetería', service: pick(x, ['servicedescription', 'service', 'servicename']) ?? '—', amount: Math.round(Number(pick(x, ['totalprice', 'amount', 'price', 'total']) ?? 0)), currency: (pick(x, ['currency']) ?? 'MXN').toUpperCase(), etaDays: Number(pick(x, ['deliveryestimate', 'deliverydays', 'days', 'etadays']) ?? 0) || 3 })).filter((rt) => rt.amount > 0)
      if (rates.length === 0) return json(502, { error: 'El agregador no devolvió tarifas.' })
      return json(200, { rates })
    }
    if (action === 'label') {
      const rate = p.rate ?? {}
      const r = await fetch(legacyBase + labelPath, { method: 'POST', headers, body: JSON.stringify(buildLegacy(p.origin, p.destination, p.parcel, rate.carrier)) })
      const data = await r.json().catch(() => ({}))
      const d = data?.data?.[0] ?? data?.data ?? data ?? {}
      const etaDays = Number(rate.etaDays ?? pick(d, ['deliveryestimate', 'deliverydays']) ?? 3)
      return json(200, { label: { carrier: rate.carrier ?? pick(d, ['carrier']) ?? 'Paquetería', service: rate.service ?? pick(d, ['service', 'servicedescription']) ?? '—', tracking: pick(d, ['trackingnumber', 'tracking', 'trackingnum']) ?? '', labelUrl: pick(d, ['label', 'labelurl', 'url', 'trackurl']) ?? '', amount: Math.round(Number(rate.amount ?? pick(d, ['totalprice', 'amount']) ?? 0)), etaDays, estimatedDeliveryAt: new Date(Date.now() + etaDays * 86_400_000).toISOString() } })
    }
    return json(400, { error: 'action inválida (usa rate | create_shipment | track | quote | label).' })
  } catch (e) {
    obs('agregador', 'provider_error', { code: 'exception', error: e })
    return json(502, { error: `Error con el agregador: ${(e as Error).message}` })
  }
}))

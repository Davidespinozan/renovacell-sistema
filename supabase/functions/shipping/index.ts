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
//   (legado) SHIPPING_API_KEY, SHIPPING_API_URL, SHIPPING_RATE_PATH, SHIPPING_LABEL_PATH
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  buildRateRequest, parseRates, buildShipmentRequest, parseShipment, parseTracking,
  dhlErrorMessage, dhlBaseUrl, isTrackingNoData, emptyTrackingResult,
  type NeutralShipper, type NeutralReceiver, type NeutralPackage,
} from './dhl.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
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
  return { provider: 'dhl', carrier: sh.carrier ?? 'DHL', service: 'DHL Express', serviceCode: sh.service_code, tracking: sh.tracking_number, labelUrl, amount: Number(sh.provider_cost ?? 0), currency: sh.currency ?? 'MXN', estimatedDeliveryAt: sh.estimated_delivery_at ?? '' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  // AUTH: usuario + rol de logística (igual que hoy).
  const sbUrl = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const caller = createClient(sbUrl, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })
  const admin = createClient(sbUrl, service, { auth: { persistSession: false } })
  const { data: me } = await admin.from('profiles').select('role_id').eq('id', who.user.id).single()
  if (!['admin', 'warehouse', 'packing'].includes(me?.role_id ?? '')) return json(403, { error: 'Solo staff de logística puede cotizar o generar guías.' })

  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = p.action

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
        if (!r.ok) return json(502, { error: dhlErrorMessage(r.status, data) })
        const rates = parseRates(data)
        if (!rates.length) return json(502, { error: 'DHL no devolvió tarifas para estos datos.' })
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
        if (!rq.ok) { await failAttempt(admin, attemptId, dhlErrorMessage(rq.status, rd)); return json(502, { error: dhlErrorMessage(rq.status, rd) }) }
        serverRate = parseRates(rd).find((x) => String(x.serviceCode) === productCode)
      } catch (e) {
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
        await markUnknown(admin, attemptId, `create timeout/network: ${(e as Error).message}`)
        return json(409, { error: 'unknown_requires_reconciliation', message: 'No se pudo confirmar el resultado con DHL; la guía pudo crearse. Requiere reconciliación (no se reintenta automáticamente).' })
      }
      const shipData = await shipResp.json().catch(() => ({}))
      if (!shipResp.ok) { await failAttempt(admin, attemptId, dhlErrorMessage(shipResp.status, shipData)); return json(502, { error: dhlErrorMessage(shipResp.status, shipData) }) }
      const { tracking, labelBase64, labelFormat } = parseShipment(shipData)
      if (!tracking) { await markUnknown(admin, attemptId, 'DHL 2xx sin tracking'); return json(409, { error: 'unknown_requires_reconciliation', message: 'DHL respondió sin número de guía; requiere reconciliación.' }) }

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
      if (finErr) { await markUnknown(admin, attemptId, `finalize: ${finErr.message}`); return json(409, { error: 'unknown_requires_reconciliation', message: 'La guía se creó en DHL pero falló el guardado local; requiere reconciliación (no se reintenta automáticamente).' }) }

      let labelUrl = ''
      if (labelPath) { const { data: sg } = await admin.storage.from(LABELS_BUCKET).createSignedUrl(labelPath, SIGNED_TTL); labelUrl = sg?.signedUrl ?? '' }
      return json(200, { label: { provider: 'dhl', carrier: 'DHL', service: serverRate.service ?? 'DHL Express', serviceCode: productCode, tracking, labelUrl, amount: serverRate.amount, currency: serverRate.currency, etaDays, estimatedDeliveryAt } })
    } catch (e) {
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
    return json(502, { error: `Error con el agregador: ${(e as Error).message}` })
  }
})

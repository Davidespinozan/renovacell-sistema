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
  dhlErrorMessage, dhlBaseUrl,
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
function missingData(shipper: NeutralShipper, receiver: NeutralReceiver, pkg: NeutralPackage): string[] {
  const m: string[] = []
  for (const [k, label] of [['name', 'remitente: razón social'], ['addressLine1', 'remitente: dirección'], ['cp', 'remitente: CP'], ['city', 'remitente: ciudad'], ['country', 'remitente: país'], ['phone', 'remitente: teléfono'], ['email', 'remitente: email']] as const) {
    if (!s((shipper as Record<string, unknown>)?.[k])) m.push(label)
  }
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
        if (!r.ok) return json(502, { error: dhlErrorMessage(r.status, data) })
        return json(200, { tracking: tn, ...parseTracking(data) })
      }

      const shipper = p.shipper as NeutralShipper
      const receiver = p.receiver as NeutralReceiver
      const pkg = p.pkg as NeutralPackage
      const miss = missingData(shipper, receiver, pkg)
      if (miss.length) return json(422, { error: 'missing_data', missing: miss })

      if (action === 'rate') {
        const r = await fetch(`${base}/rates`, { method: 'POST', headers: H, body: JSON.stringify(buildRateRequest(shipper, receiver, pkg, account)) })
        const data = await r.json().catch(() => ({}))
        if (!r.ok) return json(502, { error: dhlErrorMessage(r.status, data) })
        const rates = parseRates(data)
        if (!rates.length) return json(502, { error: 'DHL no devolvió tarifas para estos datos.' })
        return json(200, { rates })
      }

      // ---- create_shipment: idempotente, persiste y devuelve URL firmada ----
      const orderId = s(p.order_id)
      const orderRef = s(p.orderRef) || orderId
      const rate = p.rate ?? {}
      const productCode = s(rate.serviceCode) || s(p.serviceCode)
      if (!orderId) return json(400, { error: 'Falta order_id.' })
      if (!productCode) return json(400, { error: 'Falta el código de servicio (elige una tarifa).' })

      // IDEMPOTENCIA: si ya hay guía para el pedido, la devolvemos (no llamamos a DHL).
      const { data: existing } = await admin.from('shipments')
        .select('id, tracking_number, label_path, carrier, service_code, estimated_delivery_at')
        .eq('order_id', orderId).not('tracking_number', 'is', null).limit(1).maybeSingle()
      if (existing?.tracking_number) {
        let labelUrl = ''
        if (existing.label_path) {
          const { data: signed } = await admin.storage.from(LABELS_BUCKET).createSignedUrl(existing.label_path, SIGNED_TTL)
          labelUrl = signed?.signedUrl ?? ''
        }
        return json(200, { idempotent: true, label: { provider: 'dhl', carrier: 'DHL', service: rate.service ?? 'DHL Express', serviceCode: existing.service_code, tracking: existing.tracking_number, labelUrl, amount: Number(rate.amount ?? 0), etaDays: Number(rate.etaDays ?? 2), estimatedDeliveryAt: existing.estimated_delivery_at ?? '' } })
      }

      // Crear en DHL.
      const r = await fetch(`${base}/shipments`, { method: 'POST', headers: { ...H, 'Message-Reference': `${orderId}-${s(p.idempotencyKey) || crypto.randomUUID()}`.slice(0, 36) }, body: JSON.stringify(buildShipmentRequest(shipper, receiver, pkg, account, productCode, orderRef)) })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) return json(502, { error: dhlErrorMessage(r.status, data) }) // NO marca el pedido enviado
      const { tracking, labelBase64, labelFormat } = parseShipment(data)
      if (!tracking) return json(502, { error: 'DHL no devolvió número de guía.' })

      // Etiqueta base64 → Storage privado → URL firmada (nunca base64 permanente).
      let labelPath = ''
      let labelUrl = ''
      if (labelBase64) {
        const bytes = Uint8Array.from(atob(labelBase64), (c) => c.charCodeAt(0))
        labelPath = `${orderId}/${tracking}.${labelFormat.toLowerCase() === 'zpl' ? 'zpl' : 'pdf'}`
        const { error: upErr } = await admin.storage.from(LABELS_BUCKET).upload(labelPath, bytes, { contentType: labelFormat.toLowerCase() === 'zpl' ? 'application/octet-stream' : 'application/pdf', upsert: true })
        if (!upErr) { const { data: signed } = await admin.storage.from(LABELS_BUCKET).createSignedUrl(labelPath, SIGNED_TTL); labelUrl = signed?.signedUrl ?? '' }
      }

      const etaDays = Number(rate.etaDays ?? 2)
      const estimatedDeliveryAt = new Date(Date.now() + etaDays * 86_400_000).toISOString()
      // Persistir el shipment (server-side) con snapshots neutrales + metadata de auditoría.
      const row = {
        order_id: orderId, carrier: 'DHL', tracking_number: tracking, status: 'in_transit',
        estimated_delivery_at: estimatedDeliveryAt, provider: 'dhl', service_code: productCode,
        label_path: labelPath || null, package: pkg, ship_from: shipper, ship_to: receiver,
        provider_meta: { trackingNumber: tracking, labelFormat },
      }
      const { error: insErr } = await admin.from('shipments').insert(row as unknown as never)
      if (insErr) {
        // Conflicto por el índice único parcial (doble clic/carrera): devolver la existente.
        const { data: dup } = await admin.from('shipments').select('tracking_number, label_path, service_code, estimated_delivery_at').eq('order_id', orderId).not('tracking_number', 'is', null).limit(1).maybeSingle()
        if (dup?.tracking_number) {
          let u = ''
          if (dup.label_path) { const { data: sg } = await admin.storage.from(LABELS_BUCKET).createSignedUrl(dup.label_path, SIGNED_TTL); u = sg?.signedUrl ?? '' }
          return json(200, { idempotent: true, label: { provider: 'dhl', carrier: 'DHL', service: rate.service ?? 'DHL Express', serviceCode: dup.service_code, tracking: dup.tracking_number, labelUrl: u, amount: Number(rate.amount ?? 0), etaDays, estimatedDeliveryAt: dup.estimated_delivery_at ?? '' } })
        }
        return json(500, { error: `Guía creada en DHL (${tracking}) pero falló al guardar: ${insErr.message}` })
      }

      return json(200, { label: { provider: 'dhl', carrier: 'DHL', service: rate.service ?? 'DHL Express', serviceCode: productCode, tracking, labelUrl, amount: Number(rate.amount ?? 0), etaDays, estimatedDeliveryAt } })
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

// Edge Function: CFDI 4.0 (timbrado) vía Facturama (PAC), lado servidor.
// Recibe { order_id } → arma el CFDI, lo timbra en Facturama y devuelve { uuid, id }.
//
// SEAM: sin FACTURAMA_USER/FACTURAMA_PASSWORD responde 501 → el cliente usa el folio
// simulado (demo). Activar = meter secrets, sin tocar código:
//   FACTURAMA_USER, FACTURAMA_PASSWORD   (credenciales de la cuenta con CSD cargado)
//   FACTURAMA_URL       base (default https://api.facturama.mx; sandbox: apisandbox…)
//   FACTURAMA_SERIE     (opcional) serie de la factura
//   FACTURAMA_PRODUCT_CODE  ClaveProdServ SAT por defecto de los productos (default 51241100)
//   FACTURAMA_UNIT_CODE     ClaveUnidad SAT (default H87 = Pieza)
//
// NOTA fiscal: para timbrar de verdad hacen falta los DATOS FISCALES DEL RECEPTOR
// (RFC, razón social, uso CFDI, régimen, CP fiscal). Se leen del perfil del doctor
// (profiles.meta.fiscal) o del payload; si faltan, responde 422 (no timbra a ciegas).
// Los importes de la app se asumen IVA-incluido (16%) y se desglosan.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const round2 = (n: number) => Math.round(n * 100) / 100

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const user = Deno.env.get('FACTURAMA_USER')
  const pass = Deno.env.get('FACTURAMA_PASSWORD')
  if (!user || !pass) return json(501, { error: 'not_configured', message: 'CFDI no habilitado. Agrega FACTURAMA_USER/FACTURAMA_PASSWORD.' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const facBase = (Deno.env.get('FACTURAMA_URL') ?? 'https://api.facturama.mx').replace(/\/$/, '')
  const productCode = Deno.env.get('FACTURAMA_PRODUCT_CODE') ?? '51241100' // productos farmacéuticos (ajústalo)
  const unitCode = Deno.env.get('FACTURAMA_UNIT_CODE') ?? 'H87' // Pieza
  const serie = Deno.env.get('FACTURAMA_SERIE') ?? undefined

  // Solo Dirección/Facturación timbra.
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: me } = await admin.from('profiles').select('role_id').eq('id', who.user.id).single()
  if (!['admin', 'billing'].includes(me?.role_id ?? '')) return json(403, { error: 'Solo Dirección/Facturación puede timbrar.' })

  let payload: { order_id?: string; receiver?: Record<string, string> }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (!payload.order_id) return json(400, { error: 'Falta order_id.' })

  // Pedido + renglones + datos fiscales del doctor.
  const { data: order, error: oErr } = await admin.from('orders')
    .select('id, external_ref, total, currency, doctor_id, payment_method, order_items(description:product_id, qty, unit_price)')
    .eq('id', payload.order_id).single()
  if (oErr || !order) return json(404, { error: 'Pedido no encontrado.' })

  // Receptor: del payload o del perfil del doctor (meta.fiscal).
  let fiscal = payload.receiver ?? {}
  if ((!fiscal.Rfc || !fiscal.TaxZipCode) && order.doctor_id) {
    const { data: doc } = await admin.from('profiles').select('full_name, meta').eq('id', order.doctor_id).single()
    const f = ((doc?.meta as Record<string, unknown>)?.fiscal ?? {}) as Record<string, string>
    fiscal = { Name: f.name ?? doc?.full_name ?? '', Rfc: f.rfc ?? '', CfdiUse: f.cfdiUse ?? 'G03', FiscalRegime: f.taxRegime ?? '616', TaxZipCode: f.taxZip ?? '', ...fiscal }
  }
  if (!fiscal.Rfc || !fiscal.TaxZipCode || !fiscal.Name) {
    return json(422, { error: 'missing_fiscal', message: 'Faltan datos fiscales del receptor (RFC, razón social, CP). Captúralos en el perfil del doctor.' })
  }

  // Renglones: precios IVA-incluido → se desglosa 16%.
  // deno-lint-ignore no-explicit-any
  const items = ((order.order_items ?? []) as any[]).map((it) => {
    const gross = Number(it.unit_price ?? 0)
    const unitPre = round2(gross / 1.16)
    const qty = Number(it.qty ?? 1)
    const subtotal = round2(unitPre * qty)
    const iva = round2(subtotal * 0.16)
    return {
      ProductCode: productCode, Description: 'Producto Renovacell', UnitCode: unitCode, Unit: 'Pieza',
      Quantity: qty, UnitPrice: unitPre, Subtotal: subtotal, TaxObject: '02',
      Taxes: [{ Total: iva, Name: 'IVA', Base: subtotal, Rate: 0.16, IsRetention: false }],
      Total: round2(subtotal + iva),
    }
  })
  if (items.length === 0) return json(400, { error: 'El pedido no tiene renglones.' })

  const cfdi = {
    Serie: serie, Currency: (order.currency ?? 'MXN'), CfdiType: 'I',
    PaymentForm: order.payment_method === 'efectivo' ? '01' : '03', PaymentMethod: 'PUE',
    ExpeditionPlace: fiscal.TaxZipCode, // CP del lugar de expedición (usa el del emisor si difiere)
    Receiver: { Rfc: fiscal.Rfc, Name: fiscal.Name, CfdiUse: fiscal.CfdiUse ?? 'G03', FiscalRegime: fiscal.FiscalRegime ?? '616', TaxZipCode: fiscal.TaxZipCode },
    Items: items,
  }

  const auth = 'Basic ' + btoa(`${user}:${pass}`)
  const r = await fetch(`${facBase}/3/cfdis`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(cfdi) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) return json(502, { error: 'facturama', message: (data?.Message ?? data?.message ?? 'No se pudo timbrar.'), detail: data })

  // deno-lint-ignore no-explicit-any
  const d = data as any
  const uuid = d?.Complement?.TaxStamp?.Uuid ?? d?.Uuid ?? d?.uuid
  return json(200, { uuid, id: d?.Id ?? d?.id, folio: d?.Folio, date: d?.Date })
})

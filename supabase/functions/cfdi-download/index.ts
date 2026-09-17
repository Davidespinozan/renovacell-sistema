// Edge Function: DESCARGA de CFDI (XML/PDF) vía Facturama, lado servidor.
// Recibe { order_id, format:'xml'|'pdf' } → autentica y autoriza (admin/billing) → toma el
// facturama_id del pedido EN BD (nunca del cliente) → GET a Facturama con Basic auth →
// devuelve { filename, contentType, base64 }. NO persiste documentos. NO expone credenciales.
//
// SEAM: sin FACTURAMA_USER/FACTURAMA_PASSWORD responde 501 (igual que `cfdi`).
// NO toca el timbrado (función `cfdi`): es solo lectura de un CFDI ya timbrado.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { formatoValido, mimeDe, nombreArchivo, puedeDescargar } from './rules.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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

  // Solo Dirección/Facturación descarga (misma autoridad que el timbrado).
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: me } = await admin.from('profiles').select('role_id').eq('id', who.user.id).single()
  if (!['admin', 'billing'].includes(me?.role_id ?? '')) return json(403, { error: 'Solo Dirección/Facturación puede descargar.' })

  let payload: { order_id?: string; format?: unknown }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (!formatoValido(payload.format)) return json(422, { error: 'invalid_format', message: 'format debe ser "xml" o "pdf".' })
  if (!payload.order_id) return json(400, { error: 'Falta order_id.' })
  const format = payload.format

  // Pedido server-side: el facturama_id se toma de BD, jamás del cliente.
  const { data: order, error: oErr } = await admin.from('orders')
    .select('external_ref, invoice_meta').eq('id', payload.order_id).single()
  if (oErr || !order) return json(404, { error: 'Pedido no encontrado.' })

  const gate = puedeDescargar((order as { invoice_meta?: unknown }).invoice_meta)
  if (!gate.ok) return json(409, { error: gate.error, message: gate.message })

  // GET a Facturama con Basic auth server-side. type 'issued' (facturas de ingreso).
  const auth = 'Basic ' + btoa(`${user}:${pass}`)
  const endpoint = `${facBase}/api/Cfdi/${format}/issued/${gate.facturamaId}`
  const r = await fetch(endpoint, { headers: { Authorization: auth, Accept: 'application/json' } })
  if (r.status === 404) return json(404, { error: 'cfdi_not_found', message: 'El CFDI no se encontró en Facturama (¿cancelado o no disponible?).' })
  const data = await r.json().catch(() => ({}))
  // deno-lint-ignore no-explicit-any
  const content = (data as any)?.Content as string | undefined
  if (!r.ok || !content) {
    // deno-lint-ignore no-explicit-any
    const d = data as any
    return json(502, { error: 'facturama', message: d?.Message ?? d?.message ?? 'No se pudo obtener el documento.' })
  }

  return json(200, {
    filename: nombreArchivo(order.external_ref, gate.uuid, format),
    contentType: mimeDe(format),
    base64: content,
  })
})

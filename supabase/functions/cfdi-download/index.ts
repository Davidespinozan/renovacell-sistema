// Edge Function: DESCARGA de CFDI (XML/PDF) vía Facturama, lado servidor.
// Recibe { order_id, format:'xml'|'pdf' } → autentica y autoriza (admin/billing) → toma el
// facturama_id del pedido EN BD (nunca del cliente) → GET a Facturama con Basic auth →
// devuelve { filename, contentType, base64 }. NO persiste documentos. NO expone credenciales.
//
// SEAM: sin FACTURAMA_USER/FACTURAMA_PASSWORD responde 501 (igual que `cfdi`).
// NO toca el timbrado (función `cfdi`): es solo lectura de un CFDI ya timbrado.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { observador } from '../_shared/observa.ts'

// W6-A3.3 · telemetría opcional (no-op sin SENTRY_DSN; nunca altera la respuesta).
const obs = observador('cfdi-download')
import { formatoValido, mimeDe, nombreArchivo, puedeDescargar } from './rules.ts'
import { resolverFacturama } from '../_shared/facturama.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const user = Deno.env.get('FACTURAMA_USER')
  const pass = Deno.env.get('FACTURAMA_PASSWORD')
  if (!user || !pass) return json(501, { error: 'not_configured', message: 'CFDI no habilitado. Agrega FACTURAMA_USER/FACTURAMA_PASSWORD.' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  // W3-A: el entorno fiscal es explícito y la URL se DERIVA de él. Sin default a producción.
  const fac = resolverFacturama(Deno.env.get('FACTURAMA_ENV'))
  if (!fac.ok) return json(501, { error: fac.error, message: fac.message })
  const facBase = fac.base

  // Solo Dirección/Facturación descarga (misma autoridad que el timbrado).
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  const who = { user: { id: q.quien.uid } }
  if (!tieneRol(q.quien, ['admin', 'billing'])) return json(403, { error: 'Solo Dirección/Facturación puede descargar.' })

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
    obs('descargar', 'provider_error', { code: r.ok ? 'sin_contenido' : r.status, mensaje: 'Facturama no entregó el documento' })
    return json(502, { error: 'facturama', message: d?.Message ?? d?.message ?? 'No se pudo obtener el documento.' })
  }

  return json(200, {
    filename: nombreArchivo(order.external_ref, gate.uuid, format),
    contentType: mimeDe(format),
    base64: content,
  })
})

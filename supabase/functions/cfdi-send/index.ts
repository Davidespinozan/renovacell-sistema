// Edge Function: ENVÍO de CFDI por email vía Facturama, lado servidor.
// Recibe { order_id, email? } → autentica y autoriza (admin/billing) → toma el facturama_id
// del pedido EN BD (nunca del cliente) → POST a Facturama /Cfdi (CfdiType=issued, CfdiId, Email)
// con Basic auth → registra auditoría (éxito/fallo). NO persiste XML/PDF ni contenido fiscal.
//
// SEAM: sin FACTURAMA_USER/FACTURAMA_PASSWORD responde 501. NO toca el timbrado (`cfdi`) ni la
// descarga (`cfdi-download`): solo dispara el envío de un CFDI ya timbrado.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { auditarSeguro, emailValido, envioExitoso, normalizaEmail, puedeEnviar } from './rules.ts'

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

  // Solo Dirección/Facturación envía (misma autoridad que timbrado/descarga).
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: me } = await admin.from('profiles').select('role_id').eq('id', who.user.id).single()
  if (!['admin', 'billing'].includes(me?.role_id ?? '')) return json(403, { error: 'Solo Dirección/Facturación puede enviar.' })

  let payload: { order_id?: string; email?: unknown }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (!payload.order_id) return json(400, { error: 'Falta order_id.' })

  // Pedido server-side: el facturama_id se toma de BD, jamás del cliente.
  const { data: order, error: oErr } = await admin.from('orders')
    .select('external_ref, doctor_id, customer_id, invoice_meta').eq('id', payload.order_id).single()
  if (oErr || !order) return json(404, { error: 'Pedido no encontrado.' })

  const gate = puedeEnviar((order as { invoice_meta?: unknown }).invoice_meta)
  if (!gate.ok) return json(409, { error: gate.error, message: gate.message })

  // EMAIL — resolución en orden de autoridad (el POS huérfano ya NO es autoridad):
  //   0) override de la UI (captura manual del admin)
  //   1) snapshot del pedido: invoice_meta.receiver.email_facturacion
  //   2) master del cliente: customers.meta.fiscal.email_facturacion
  //   3) legacy/contacto: profiles.email por doctor_id
  const override = normalizaEmail(payload.email)
  let email = ''
  if (override) {
    if (!emailValido(override)) return json(422, { error: 'email_invalid', message: 'El correo no es válido.' })
    email = override
  } else {
    const inv = ((order as { invoice_meta?: unknown }).invoice_meta ?? {}) as Record<string, unknown>
    const rcv = (inv.receiver ?? {}) as Record<string, unknown>
    email = normalizaEmail(typeof rcv.email_facturacion === 'string' ? rcv.email_facturacion : '')
    if (!email && (order as { customer_id?: string }).customer_id) {
      const { data: cust } = await admin.from('customers').select('meta').eq('id', (order as { customer_id: string }).customer_id).maybeSingle()
      const cf = (cust?.meta as Record<string, unknown> | null)?.fiscal as Record<string, unknown> | undefined
      email = normalizaEmail(typeof cf?.email_facturacion === 'string' ? cf.email_facturacion : '')
    }
    if (!email && order.doctor_id) {
      const { data: doc } = await admin.from('profiles').select('email').eq('id', order.doctor_id).single()
      email = normalizaEmail(doc?.email)
    }
    if (!email) return json(422, { error: 'email_missing', message: 'No hay correo de facturación; captúralo para enviar.' })
    if (!emailValido(email)) return json(422, { error: 'email_invalid', message: 'El correo de facturación no es válido.' })
  }

  const resource = order.external_ref ?? payload.order_id
  const at = new Date().toISOString()

  // POST a Facturama. Solo comportamiento default (sin Subject/Comments/IssuerEmail/IncludePayBtn).
  const qs = new URLSearchParams({ CfdiType: 'issued', CfdiId: gate.facturamaId, Email: email })
  const auth = 'Basic ' + btoa(`${user}:${pass}`)
  const r = await fetch(`${facBase}/Cfdi?${qs.toString()}`, { method: 'POST', headers: { Authorization: auth, Accept: 'application/json' } })
  const data = await r.json().catch(() => ({}))

  if (!envioExitoso(r.status, data)) {
    // deno-lint-ignore no-explicit-any
    const d = data as any
    // Auditar el FALLO (best-effort) — nunca como enviado. Si la auditoría también falla, se
    // conserva el 502 ORIGINAL de Facturama (no se enmascara con otro error).
    await auditarSeguro(() => caller.rpc('log_audit', { p_action: 'CFDI envío fallido', p_resource: resource, p_detail: JSON.stringify({ to: email, at, result: 'error' }), p_actor_name: 'Administración' }))
    return json(502, { error: 'facturama', message: d?.msj ?? d?.Message ?? d?.message ?? 'No se pudo enviar el CFDI.' })
  }

  // El envío YA ocurrió (2xx + success). Auditar el ÉXITO es best-effort: aunque log_audit
  // falle (devuelva {error} o lance), NUNCA se convierte en error para el frontend — así el
  // usuario no reintenta y no se duplica el CFDI. Sin XML/PDF/base64/credenciales/email en logs.
  await auditarSeguro(() => caller.rpc('log_audit', { p_action: 'CFDI enviado', p_resource: resource, p_detail: JSON.stringify({ to: email, at, result: 'ok' }), p_actor_name: 'Administración' }))
  return json(200, { ok: true, email })
})

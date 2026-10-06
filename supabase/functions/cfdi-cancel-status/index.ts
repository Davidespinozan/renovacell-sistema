// Edge Function: SINCRONIZACIÓN del estatus de una cancelación PENDIENTE (solo lectura remota).
// Recibe { order_id } → autentica/autoriza (admin/billing) → GET a Facturama del detalle del CFDI →
// mapea Status → actualiza invoice_meta.cancel.status PRESERVANDO el resto. NUNCA hace DELETE.
// NO usa /cfdi/status en esta versión (usa GET /cfdi/{id}?type=issued).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { observador } from '../_shared/observa.ts'

// W6-A3.3 · telemetría opcional (no-op sin SENTRY_DSN; nunca altera la respuesta).
const obs = observador('cfdi-cancel-status')
import { accionActualizacion, actualizaCancelStatus, auditarSeguro, mapeaStatusDetalle, puedeConsultar } from './rules.ts'
import { resolverFacturama } from '../_shared/facturama.ts'
import { conCors } from '../_shared/cors.ts'   // CC-0B.2 · lista blanca de orígenes (antes '*')

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const user = Deno.env.get('FACTURAMA_USER'), pass = Deno.env.get('FACTURAMA_PASSWORD')
  if (!user || !pass) return json(501, { error: 'not_configured', message: 'CFDI no habilitado.' })
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  // W3-A: el entorno fiscal es explícito y la URL se DERIVA de él. Sin default a producción.
  const fac = resolverFacturama(Deno.env.get('FACTURAMA_ENV'))
  if (!fac.ok) return json(501, { error: fac.error, message: fac.message })
  const facBase = fac.base

  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  const who = { user: { id: q.quien.uid } }
  if (!tieneRol(q.quien, ['admin', 'billing'])) return json(403, { error: 'Solo Dirección/Facturación puede consultar.' })

  let payload: { order_id?: string }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (!payload.order_id) return json(400, { error: 'Falta order_id.' })

  const { data: order, error: oErr } = await admin.from('orders').select('external_ref, invoice_meta').eq('id', payload.order_id).single()
  if (oErr || !order) return json(404, { error: 'Pedido no encontrado.' })

  const gate = puedeConsultar((order as { invoice_meta?: unknown }).invoice_meta)
  if (!gate.ok) return json(409, { error: gate.error, message: gate.message })

  // Lectura remota del detalle (NUNCA DELETE).
  const auth = 'Basic ' + btoa(`${user}:${pass}`)
  const r = await fetch(`${facBase}/cfdi/${gate.facturamaId}?type=issued`, { headers: { Authorization: auth, Accept: 'application/json' } })
  const data = await r.json().catch(() => ({}))
  // deno-lint-ignore no-explicit-any
  const x = data as any
  if (!r.ok) { obs('consultar', 'provider_error', { code: r.status, mensaje: 'Facturama respondió error al consultar estatus' }); return json(502, { error: 'facturama', message: x?.Message ?? x?.message ?? 'No se pudo consultar el estatus.' }) }

  const nuevo = mapeaStatusDetalle(x?.Status)
  const resource = order.external_ref ?? payload.order_id
  // Estatus desconocido/ausente → conservar 'pendiente' sin cambios ni error remoto que altere estado.
  if (!nuevo || nuevo === 'pendiente') return json(200, { ok: true, cancel: { status: 'pendiente' }, changed: false })

  const now = new Date().toISOString()
  const meta = actualizaCancelStatus((order as { invoice_meta?: unknown }).invoice_meta, nuevo, now)
  const accion = accionActualizacion('pendiente', nuevo)
  if (accion) await auditarSeguro(() => caller.rpc('log_audit', { p_action: accion, p_resource: resource, p_detail: JSON.stringify({ at: now, status: nuevo }), p_actor_name: 'Administración' }))

  const { error: upErr } = await admin.from('orders').update({ invoice_meta: meta }).eq('id', payload.order_id)
  if (upErr) {
    console.warn('[cfdi-cancel-status] persist', upErr.message)
    obs('consultar', 'internal_error', { code: 'persist', error: upErr })
    return json(500, { error: 'persist', message: 'No se pudo guardar el estatus actualizado.', remote_status: nuevo })
  }
  return json(200, { ok: true, cancel: { status: nuevo, confirmed_at: nuevo === 'cancelada' ? now : undefined }, changed: true })
}))

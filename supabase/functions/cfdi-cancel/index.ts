// Edge Function: CANCELACIÓN de CFDI motivos 02/03 (sin relación), lado servidor.
// Recibe { order_id, motive:'02'|'03', confirm:true } → autentica/autoriza (admin/billing) →
// toma facturama_id del pedido EN BD → DELETE a Facturama → mapea Status → persiste invoice_meta.cancel
// PRESERVANDO el resto. NO toca order/pago/inventario/comisión/invoice_requested. NO motivo 01/04.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { accionAuditoria, auditarSeguro, construyeCancelMeta, construyeClaimMeta, mapeaStatusCancelacion, motivoCancelValido, puedeCancelar } from './rules.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const user = Deno.env.get('FACTURAMA_USER'), pass = Deno.env.get('FACTURAMA_PASSWORD')
  if (!user || !pass) return json(501, { error: 'not_configured', message: 'CFDI no habilitado.' })
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const facBase = (Deno.env.get('FACTURAMA_URL') ?? 'https://api.facturama.mx').replace(/\/$/, '')

  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: me } = await admin.from('profiles').select('role_id').eq('id', who.user.id).single()
  if (!['admin', 'billing'].includes(me?.role_id ?? '')) return json(403, { error: 'Solo Dirección/Facturación puede cancelar.' })

  let payload: { order_id?: string; motive?: unknown; confirm?: unknown }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (payload.confirm !== true) return json(422, { error: 'confirm_required', message: 'Se requiere confirmación explícita.' })
  if (!motivoCancelValido(payload.motive)) return json(422, { error: 'invalid_motive', message: 'motive debe ser "02" o "03".' })
  if (!payload.order_id) return json(400, { error: 'Falta order_id.' })
  const motive = payload.motive

  const { data: order, error: oErr } = await admin.from('orders').select('external_ref, invoice_meta').eq('id', payload.order_id).single()
  if (oErr || !order) return json(404, { error: 'Pedido no encontrado.' })

  const gate = puedeCancelar((order as { invoice_meta?: unknown }).invoice_meta)
  if (!gate.ok) return json(409, { error: gate.error, message: gate.message })

  const original = (order as { invoice_meta?: unknown }).invoice_meta
  const resource = order.external_ref ?? payload.order_id
  const requested_at = new Date().toISOString()
  const claimId = crypto.randomUUID()

  // ── CLAIM ATÓMICO (anti doble-DELETE por concurrencia) ────────────────────────────────────
  // UPDATE condicional: solo escribe si cancel está ausente (status null) o 'rechazada'. El WHERE
  // se evalúa bajo lock de fila → de dos requests simultáneos, uno reclama (1 fila) y el otro
  // obtiene 0 filas → 409 SIN llamar a Facturama. No es SELECT→check→UPDATE: la condición es parte
  // atómica del propio UPDATE. .select() nos dice inequívocamente si ganamos la fila.
  const claimMeta = construyeClaimMeta(original, motive, requested_at, claimId)
  const { data: claimed, error: claimErr } = await admin.from('orders')
    .update({ invoice_meta: claimMeta })
    .eq('id', payload.order_id)
    .or('invoice_meta->cancel->>status.is.null,invoice_meta->cancel->>status.eq.rechazada')
    .select('id')
  if (claimErr) return json(500, { error: 'claim_failed', message: 'No se pudo iniciar la cancelación.' })
  if (!claimed || claimed.length === 0) return json(409, { error: 'already_requested', message: 'La cancelación ya está en curso o el CFDI ya está cancelado.' })

  // Ya tenemos el claim. DELETE a Facturama — EXACTAMENTE UNO. facturama_id SIEMPRE de BD.
  const qs = new URLSearchParams({ type: 'issued', motive })
  const auth = 'Basic ' + btoa(`${user}:${pass}`)
  let r: Response
  try {
    r = await fetch(`${facBase}/cfdi/${gate.facturamaId}?${qs.toString()}`, { method: 'DELETE', headers: { Authorization: auth, Accept: 'application/json' } })
  } catch (_e) {
    // AMBIGÜEDAD (network/timeout): NO sabemos si Facturama/SAT procesó la cancelación. Conservar
    // 'solicitada' (NO liberar), NO reintentar DELETE. Requiere reconciliación posterior.
    await auditarSeguro(() => caller.rpc('log_audit', { p_action: 'CFDI cancelación fallida', p_resource: resource, p_detail: JSON.stringify({ motive, at: requested_at, status: 'incierto' }), p_actor_name: 'Administración' }))
    return json(502, { error: 'fiscal_incierto', message: 'No se pudo confirmar si Facturama/SAT procesó la cancelación (posible timeout). El estado quedó como "solicitada"; requiere reconciliación. No se reintentó.' })
  }
  const data = await r.json().catch(() => ({}))
  // deno-lint-ignore no-explicit-any
  const x = (Array.isArray(data) ? (data as any[])[0] : data) as any
  const status = r.ok ? mapeaStatusCancelacion(x?.Status) : null

  if (!status) {
    // Error HTTP INEQUÍVOCO (respondió, pero fallo/Status no mapeable). Liberar SOLO nuestro claim
    // (condicionado a claim_id) y devolver el error ORIGINAL de Facturama.
    await admin.from('orders').update({ invoice_meta: (original ?? null) as Record<string, unknown> })
      .eq('id', payload.order_id)
      .eq('invoice_meta->cancel->>status', 'solicitada')
      .eq('invoice_meta->cancel->>claim_id', claimId)
    await auditarSeguro(() => caller.rpc('log_audit', { p_action: 'CFDI cancelación fallida', p_resource: resource, p_detail: JSON.stringify({ motive, at: requested_at, status: 'error' }), p_actor_name: 'Administración' }))
    return json(502, { error: 'facturama', message: x?.Message ?? x?.message ?? 'No se pudo cancelar el CFDI.' })
  }

  // Auditar el resultado fiscal REAL (best-effort; un fallo de audit no altera el resultado).
  await auditarSeguro(() => caller.rpc('log_audit', { p_action: accionAuditoria(status), p_resource: resource, p_detail: JSON.stringify({ motive, at: requested_at, status }), p_actor_name: 'Administración' }))

  // Reemplazar el claim por el estado FINAL (sin claim_id), solo si sigue siendo NUESTRO claim.
  const meta = construyeCancelMeta(original, {
    status, motive, requested_at,
    confirmed_at: status === 'cancelada' ? requested_at : undefined,
    expiration_at: x?.ExpirationDate ?? undefined,
    is_cancelable: x?.IsCancelable ?? undefined,
    message: x?.Message ?? undefined,
    acuse_available: !!x?.AcuseXmlBase64,
  })
  const { data: finalized, error: upErr } = await admin.from('orders')
    .update({ invoice_meta: meta })
    .eq('id', payload.order_id)
    .eq('invoice_meta->cancel->>status', 'solicitada')
    .eq('invoice_meta->cancel->>claim_id', claimId)
    .select('id')
  if (upErr || !finalized || finalized.length === 0) {
    // La cancelación fiscal YA ocurrió; falló persistir el estado final. NO reintentar DELETE, NO
    // revertir el claim (el estado remoto cambió). Requiere reconciliación.
    console.warn('[cfdi-cancel] persist_after_cancel', upErr?.message)
    return json(500, { error: 'persist_after_cancel', message: 'La cancelación se realizó en el SAT/Facturama pero no se pudo guardar el estado final. Requiere reconciliación. No reintentar cancelar.', fiscal_status: status })
  }

  return json(200, { ok: true, cancel: { status, motive, requested_at, acuse_available: !!x?.AcuseXmlBase64, expiration_at: x?.ExpirationDate ?? null } })
})

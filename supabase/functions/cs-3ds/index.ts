// Edge Function · CS-1A.4 · Payer Authentication 3DS (CyberSource / BanBajío) para el portal del doctor.
//
// Acciones (POST JSON {accion, attempt_id, …}; siempre con el JWT del doctor):
//   setup    {token}                 created|tokenized → tokenized → auth_setup   (POST /risk/v1/authentication-setups)
//   enroll   {token, dispositivo}    auth_setup → auth_pending → auth_validated | auth_challenge | declined (POST /risk/v1/authentications)
//   validate {}                      auth_challenge → auth_validated | declined | (sigue en reto si aún no termina) (POST /risk/v1/authentication-results)
//   estado   {}                      solo lectura: estado actual para recuperar un flujo interrumpido
//   abandonar{}                      created…auth_challenge → failed_safe_to_retry (el doctor empieza de nuevo; nunca hubo cargo)
// Reglas: el token transitorio solo se reenvía a CyberSource (no se persiste ni se registra); importe y moneda salen del intento
// (fijados por el servidor); las transiciones las aplica cs_intento_avanzar (service_role) y los estados se verifican antes de
// llamar al proveedor; el navegador no elige importes, entorno, referencias ni URLs: las URLs de Cardinal se validan por host.
// NO llama a /pts/v2/payments. NO contabiliza. NO libera reservas. Sin secretos ni cabeceras firmadas en respuestas/logs.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { conCors } from '../_shared/cors.ts'
import { observador } from '../_shared/observa.ts'
import { csConfig, solicitarCS, RUTAS_CS } from '../_shared/cybersource.ts'
import {
  ORIGENES_DDC, RUTA_RETORNO_3DS, ESTADOS_ACCION, buildSetupRequest, leerSetup, normalizarDispositivo, buildBillTo, buildEnrollRequest, leerEnroll,
  buildValidateRequest, leerValidate, datosAvance, VENTANAS_RETO,
} from './contrato.ts'

const obs = observador('cs-3ds')
const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Intento = { id: string; order_id: string; doctor_id: string; ambiente: 'test' | 'production'; amount: number; status: string; cs_auth_reference_id: string | null; cs_auth_transaction_id: string | null; cs_auth_status: string | null }

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!(tieneRol(q.quien, ['admin']) || (q.quien.role === 'doctor' && q.quien.verified))) return json(403, { error: 'no_verificado', message: 'Tu cuenta aún no está verificada por Renovacell.' })

  let p: { accion?: string; attempt_id?: string; token?: string; dispositivo?: unknown }
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const accion = String(p.accion ?? '')
  const attemptId = String(p.attempt_id ?? '')
  if (!UUID.test(attemptId)) return json(400, { error: 'Falta attempt_id.' })
  if (!['setup', 'enroll', 'validate', 'estado', 'abandonar'].includes(accion)) return json(400, { error: 'accion_invalida' })

  // El intento se lee con el JWT del llamante: la RLS de card_payment_attempts solo deja ver el propio (o todos a Dirección/Facturación).
  const { data: a, error: aErr } = await caller.from('card_payment_attempts')
    .select('id, order_id, doctor_id, ambiente, amount, status, cs_auth_reference_id, cs_auth_transaction_id, cs_auth_status').eq('id', attemptId).maybeSingle()
  if (aErr || !a) return json(404, { error: 'intento_inexistente', message: 'No encontramos este intento de pago.' })
  const intento = a as Intento
  if (q.quien.role === 'doctor' && intento.doctor_id !== q.quien.uid) return json(403, { error: 'no_autorizado', message: 'Ese intento no es tuyo.' })

  if (accion === 'estado') {
    return json(200, { estado: intento.status, amount: Number(intento.amount), ambiente: intento.ambiente, puede_validar: intento.status === 'auth_challenge',
                       requiere_tarjeta: ['created', 'tokenized', 'auth_setup', 'auth_pending'].includes(intento.status), bloqueado: intento.status === 'unknown_requires_reconciliation' })
  }
  const avanzar = async (estado: string, datos: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc('cs_intento_avanzar', { p_attempt: attemptId, p_estado: estado, p_datos: datos })
    if (error) { obs(accion, 'internal_error', { code: 'rpc_error', error }); throw new Error(`avanzar:${error.message}`) }
    return data as { status: string; estado: string }
  }
  const estadoValido = (acc: keyof typeof ESTADOS_ACCION) => ESTADOS_ACCION[acc].includes(intento.status)

  if (accion === 'abandonar') {
    if (!estadoValido('abandonar')) return json(409, { error: 'estado_invalido', estado: intento.status, message: 'Este intento ya no puede abandonarse.' })
    await avanzar('failed_safe_to_retry', { error: 'abandonado por el cliente antes de enviar al banco' })
    return json(200, { estado: 'failed_safe_to_retry' })
  }

  const conf = csConfig(Deno.env.get)
  if (!conf.ok) return json(conf.motivo === 'produccion_deshabilitada' ? 503 : 501, { error: conf.motivo === 'produccion_deshabilitada' ? 'produccion_deshabilitada' : 'not_configured', message: 'El pago con tarjeta aún no está disponible.' })
  const cfg = conf.cfg
  if (cfg.ambiente !== intento.ambiente) return json(409, { error: 'ambiente_distinto', message: 'Este intento pertenece a otro ambiente. Empieza de nuevo.' })
  const amount = Number(intento.amount)
  const token = typeof p.token === 'string' ? p.token : ''

  // ── setup ───────────────────────────────────────────────────────────────────────────────────────────────────────
  if (accion === 'setup') {
    if (!estadoValido('setup')) return json(409, { error: 'estado_invalido', estado: intento.status, message: 'La verificación ya está en otro paso.' })
    let cuerpo
    try { cuerpo = buildSetupRequest(attemptId, token) } catch { return json(400, { error: 'token_invalido', message: 'Vuelve a capturar la tarjeta.' }) }
    const r = await solicitarCS(cfg, { metodo: 'POST', ruta: RUTAS_CS.payerSetup, cuerpo })
    if (!r.ok) {
      if (r.clase === 'http') { obs('setup', 'provider_error', { code: r.status, mensaje: r.mensaje }); return json(r.status === 400 ? 400 : 502, { error: r.status === 400 ? 'token_rechazado' : 'proveedor', message: r.status === 400 ? 'La tarjeta no pudo verificarse. Vuelve a capturarla.' : 'No se pudo iniciar la verificación. Intenta de nuevo.' }) }
      if (r.clase === 'resultado_desconocido') { obs('setup', 'provider_error', { code: r.motivo, mensaje: r.mensaje }); return json(503, { error: 'proveedor_sin_respuesta', message: 'El banco no respondió. Intenta de nuevo en un momento.' }) }
      obs('setup', 'internal_error', { code: 'firma', mensaje: r.mensaje }); return json(500, { error: 'edge' })
    }
    const l = leerSetup(r.data)
    if (!l.ok) { obs('setup', 'provider_error', { code: l.motivo, mensaje: l.detalle }); return json(502, { error: 'contrato', message: 'No se pudo iniciar la verificación. Intenta de nuevo.' }) }
    if (intento.status === 'created') await avanzar('tokenized')
    await avanzar('auth_setup', { cs_auth_reference_id: l.referenceId })
    return json(200, { estado: 'auth_setup', reference_id: l.referenceId, ddc_url: l.ddcUrl, ddc_token: l.accessToken, ddc_origen: ORIGENES_DDC[cfg.ambiente], ddc_timeout_ms: 10000 })
  }

  // ── enroll ──────────────────────────────────────────────────────────────────────────────────────────────────────
  if (accion === 'enroll') {
    if (!estadoValido('enroll')) return json(409, { error: 'estado_invalido', estado: intento.status, message: 'La verificación ya está en otro paso.' })
    if (!intento.cs_auth_reference_id) return json(409, { error: 'sin_setup', message: 'Falta el paso previo de verificación.' })
    const dispositivo = normalizarDispositivo(p.dispositivo, { accept: req.headers.get('accept'), userAgent: req.headers.get('user-agent'), ip: req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') })
    if (!dispositivo) return json(400, { error: 'dispositivo_incompleto', message: 'No se pudo leer la información del navegador.' })
    // Bill-to con lo que el ERP ya sabe: domicilio del pedido (snapshot), cliente del pedido y perfil del doctor. Nunca lo manda el navegador.
    const [{ data: o }, { data: pr }] = await Promise.all([
      admin.from('orders').select('shipping_meta, customer_id').eq('id', intento.order_id).maybeSingle(),
      admin.from('profiles').select('full_name, email').eq('id', intento.doctor_id).maybeSingle(),   // profiles no tiene teléfono: el teléfono sale del domicilio o del cliente
    ])
    const meta = ((o as { shipping_meta?: Record<string, unknown> } | null)?.shipping_meta ?? {}) as Record<string, unknown>
    const address = (meta.address && typeof meta.address === 'object' ? meta.address : null) as Record<string, unknown> | null
    const perfil = (pr ?? {}) as { full_name?: string; email?: string }
    let cliente: { full_name?: string; email?: string; phone?: string } = {}
    const customerId = (o as { customer_id?: string } | null)?.customer_id
    if (customerId) { const { data: c } = await admin.from('customers').select('full_name, email, phone').eq('id', customerId).maybeSingle(); cliente = (c ?? {}) as typeof cliente }
    const bt = buildBillTo({ nombre: String(address?.nombre ?? cliente.full_name ?? perfil.full_name ?? ''), email: String(cliente.email ?? perfil.email ?? q.quien.email ?? ''), phone: String(address?.phone ?? cliente.phone ?? ''), address })
    if (!bt.ok) return json(409, { error: 'datos_incompletos', faltan: bt.faltan, message: 'Faltan datos de facturación del pedido (domicilio, correo o teléfono). Completa tu perfil o elige un domicilio.' })
    let cuerpo
    try { cuerpo = buildEnrollRequest({ attemptId, token, amount, billTo: bt.billTo, referenceId: intento.cs_auth_reference_id, returnUrl: `${url}${RUTA_RETORNO_3DS}`, dispositivo }) }
    catch { return json(400, { error: 'token_invalido', message: 'Vuelve a capturar la tarjeta.' }) }
    await avanzar('auth_pending')   // "enrolamiento solicitado" queda registrado ANTES de llamar
    const r = await solicitarCS(cfg, { metodo: 'POST', ruta: RUTAS_CS.payerEnroll, cuerpo })
    if (!r.ok) {
      const msg = r.clase === 'http' ? r.mensaje : r.mensaje
      obs('enroll', r.clase === 'http' ? 'provider_error' : r.clase === 'resultado_desconocido' ? 'unknown' : 'internal_error', { code: r.clase === 'http' ? r.status : r.clase, mensaje: msg })
      // sin dinero de por medio: el intento se cierra como fallo seguro y el doctor puede empezar de nuevo
      await avanzar('failed_safe_to_retry', { error: `enroll: ${msg}` })
      return json(r.clase === 'http' ? 502 : 503, { estado: 'failed_safe_to_retry', error: r.clase === 'http' ? 'proveedor' : 'proveedor_sin_respuesta', message: 'No se pudo verificar la tarjeta con tu banco. Intenta de nuevo.' })
    }
    const l = leerEnroll(r.data)
    if (!l.ok) { obs('enroll', 'provider_error', { code: l.motivo, mensaje: l.detalle }); await avanzar('failed_safe_to_retry', { error: `enroll: ${l.motivo}` }); return json(502, { estado: 'failed_safe_to_retry', error: 'contrato', message: 'No se pudo verificar la tarjeta con tu banco. Intenta de nuevo.' }) }
    if (l.resultado === 'autenticada') { await avanzar('auth_validated', datosAvance(l.evidencia, 'AUTHENTICATION_SUCCESSFUL')); return json(200, { estado: 'auth_validated', reto: false }) }
    if (l.resultado === 'rechazada') { await avanzar('declined', { ...datosAvance(l.evidencia, 'AUTHENTICATION_FAILED'), cs_reason: l.motivo }); return json(200, { estado: 'declined', message: 'Tu banco no autenticó la tarjeta. Intenta con otra tarjeta.' }) }
    await avanzar('auth_challenge', datosAvance(l.evidencia, 'PENDING_AUTHENTICATION'))
    return json(200, { estado: 'auth_challenge', reto: true, step_up_url: l.stepUpUrl, step_up_token: l.accessToken, ventana: l.ventana, ventana_px: VENTANAS_RETO[l.ventana], retorno_origen: new URL(url).origin })
  }

  // ── validate ────────────────────────────────────────────────────────────────────────────────────────────────────
  if (!estadoValido('validate')) return json(409, { error: 'estado_invalido', estado: intento.status, message: intento.status === 'auth_validated' ? 'La tarjeta ya está autenticada.' : 'La verificación no está en el paso de validación.' })
  if (!intento.cs_auth_transaction_id) return json(409, { error: 'sin_transaccion', message: 'Falta la referencia de autenticación.' })
  let cuerpoV
  try { cuerpoV = buildValidateRequest(attemptId, intento.cs_auth_transaction_id, amount) } catch { return json(409, { error: 'sin_transaccion' }) }
  const rv = await solicitarCS(cfg, { metodo: 'POST', ruta: RUTAS_CS.payerValidate, cuerpo: cuerpoV })
  if (!rv.ok) {
    // validar no mueve dinero y se puede repetir: el intento se queda en auth_challenge
    if (rv.clase === 'http') { obs('validate', 'provider_error', { code: rv.status, mensaje: rv.mensaje }); return json(502, { estado: 'auth_challenge', error: 'proveedor', message: 'No se pudo confirmar la verificación. Intenta de nuevo.' }) }
    if (rv.clase === 'resultado_desconocido') { obs('validate', 'unknown', { code: rv.motivo, mensaje: rv.mensaje }); return json(503, { estado: 'auth_challenge', error: 'proveedor_sin_respuesta', message: 'El banco no respondió. Intenta de nuevo en un momento.' }) }
    obs('validate', 'internal_error', { code: 'firma', mensaje: rv.mensaje }); return json(500, { error: 'edge' })
  }
  const lv = leerValidate(rv.data)
  if (!lv.ok) { obs('validate', 'provider_error', { code: lv.motivo, mensaje: lv.detalle }); return json(502, { estado: 'auth_challenge', error: 'contrato', message: 'No se pudo confirmar la verificación. Intenta de nuevo.' }) }
  if (lv.resultado === 'pendiente') return json(200, { estado: 'auth_challenge', pendiente: true, message: 'La verificación con tu banco aún no termina.' })
  if (lv.resultado === 'rechazada') { await avanzar('declined', { ...datosAvance(lv.evidencia, 'AUTHENTICATION_FAILED'), cs_reason: lv.motivo }); return json(200, { estado: 'declined', message: 'Tu banco no autenticó la tarjeta. Intenta con otra tarjeta.' }) }
  await avanzar('auth_validated', datosAvance(lv.evidencia, 'AUTHENTICATION_SUCCESSFUL'))
  return json(200, { estado: 'auth_validated' })
}))

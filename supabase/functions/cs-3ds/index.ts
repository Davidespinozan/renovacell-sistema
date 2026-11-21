// Edge Function · CS-1A.4 · Payer Authentication 3DS (CyberSource / BanBajío) para el portal del doctor.
// CS-BB (21 nov 2026) · alineado al manual de BanBajío: jti del token transitorio (firma RS256 verificada) en setup, enroll y
// validate; política paresStatus del dueño (Y/A cobrar, C reto, resto rechazo sin cobro); valores 3DS a card_payment_3ds_auth
// (corta vida, solo servidor) para la venta; returnUrl en el dominio de la app; bitácora de pruebas en sandbox.
//
// Acciones (POST JSON {accion, attempt_id, …}; siempre con el JWT del doctor):
//   setup    {token}                    created|tokenized → tokenized → auth_setup   (POST /risk/v1/authentication-setups)
//                                       Si el intento ya pasó por 3DS con OTRO token (otra captura de tarjeta) → failed_safe_to_retry +
//                                       'reautenticar': nunca se cobra una tarjeta nueva con una autenticación vieja.
//   enroll   {token, dispositivo}       auth_setup → auth_pending → auth_validated | auth_challenge | declined (POST /risk/v1/authentications)
//   validate {transaction_id?}          auth_challenge → auth_validated | declined | (sigue en reto si aún no termina) (POST /risk/v1/authentication-results)
//                                       transaction_id (lo que el banco devolvió al returnUrl) debe coincidir con el guardado.
//   estado   {}                         solo lectura: estado actual para recuperar un flujo interrumpido
//   abandonar{}                         created…auth_challenge → failed_safe_to_retry (el doctor empieza de nuevo; nunca hubo cargo)
// Reglas: el token transitorio solo se lee en memoria (firma + jti + exp); se persisten jti y su expiración en la tabla de corta vida
// (no el JWT). Token caducado (15 min) → 'tarjeta_expirada' (la UI pide recapturar). Importe y moneda salen del intento; las
// transiciones las aplica cs_intento_avanzar (service_role); el navegador no elige importes, entorno, referencias ni URLs.
// NO llama a /pts/v2/payments. NO contabiliza. NO libera reservas. Sin secretos ni cabeceras firmadas en respuestas/logs.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { conCors, origenPermitido } from '../_shared/cors.ts'
import { observador } from '../_shared/observa.ts'
import { csConfig, RUTAS_CS } from '../_shared/cybersource.ts'
import { verificarTokenTransitorio, marcaTarjeta, type TokenTransitorio } from '../_shared/csJwt.ts'
import { llamarCS, obtenedorJwkCS } from '../_shared/csEdge.ts'
import {
  ORIGENES_DDC, ESTADOS_ACCION, buildSetupRequest, leerSetup, normalizarDispositivo, buildBillTo, buildEnrollRequest, leerEnroll,
  buildValidateRequest, leerValidate, datosAvance, VENTANAS_RETO, construirReturnUrl, decidirReentrada, fila3dsSetup, actualizarFila3ds,
  MENSAJE_RECHAZO_3DS, MENSAJE_TARJETA_EXPIRADA, MENSAJE_REAUTENTICAR, type Fila3ds,
} from './contrato.ts'

const obs = observador('cs-3ds')
const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Intento = { id: string; order_id: string; doctor_id: string; ambiente: 'test' | 'production'; amount: number; status: string; cs_auth_reference_id: string | null; cs_auth_transaction_id: string | null; cs_auth_status: string | null }
/** Estados en los que llegar con un token nuevo exige comparar contra la autenticación previa. */
const ESTADOS_CON_3DS = ['auth_setup', 'auth_pending', 'auth_challenge', 'auth_validated']

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!(tieneRol(q.quien, ['admin']) || (q.quien.role === 'doctor' && q.quien.verified))) return json(403, { error: 'no_verificado', message: 'Tu cuenta aún no está verificada por Renovacell.' })

  let p: { accion?: string; attempt_id?: string; token?: string; dispositivo?: unknown; transaction_id?: string }
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
  // CS-BB · datos 3DS de corta vida (solo servidor; la RLS no deja a nadie más).
  const leer3ds = async (): Promise<Fila3ds | null> => {
    const { data } = await admin.from('card_payment_3ds_auth')
      .select('attempt_id, jti, token_exp, card_brand, authentication_transaction_id, pares_status, eci, eci_raw, cavv, xid, ucaf_collection_indicator, ucaf_authentication_data, directory_server_transaction_id, specification_version, ecommerce_indicator, fuente, expires_at').eq('attempt_id', attemptId).maybeSingle()
    return (data as Fila3ds | null) ?? null
  }
  const guardar3ds = async (f: Fila3ds) => {
    const { error } = await admin.from('card_payment_3ds_auth').upsert({ ...f, updated_at: new Date().toISOString() }, { onConflict: 'attempt_id' })
    if (error) { obs(accion, 'internal_error', { code: 'guardar_3ds', error }); throw new Error('guardar_3ds') }
  }
  const borrar3ds = async () => { try { await admin.from('card_payment_3ds_auth').delete().eq('attempt_id', attemptId) } catch { /* la tarea de limpieza lo borra a la hora */ } }

  if (accion === 'abandonar') {
    if (!estadoValido('abandonar')) return json(409, { error: 'estado_invalido', estado: intento.status, message: 'Este intento ya no puede abandonarse.' })
    await avanzar('failed_safe_to_retry', { error: 'abandonado por el cliente antes de enviar al banco' })
    await borrar3ds()
    return json(200, { estado: 'failed_safe_to_retry' })
  }

  const conf = csConfig(Deno.env.get)
  if (!conf.ok) return json(conf.motivo === 'produccion_deshabilitada' ? 503 : 501, { error: conf.motivo === 'produccion_deshabilitada' ? 'produccion_deshabilitada' : 'not_configured', message: 'El pago con tarjeta aún no está disponible.' })
  const cfg = conf.cfg
  if (cfg.ambiente !== intento.ambiente) return json(409, { error: 'ambiente_distinto', message: 'Este intento pertenece a otro ambiente. Empieza de nuevo.' })
  const amount = Number(intento.amount)

  // Token transitorio del navegador: firma RS256 verificada (llave del kid), jti y expiración. Nunca se guarda el JWT.
  const leerToken = async (): Promise<{ ok: true; t: TokenTransitorio } | { ok: false; resp: Response; expirado?: boolean }> => {
    const token = typeof p.token === 'string' ? p.token : ''
    if (!token) return { ok: false, resp: json(400, { error: 'token_invalido', message: 'Vuelve a capturar la tarjeta.' }) }
    const l = await verificarTokenTransitorio(token, obtenedorJwkCS(cfg))
    if (l.ok) return { ok: true, t: l.token }
    if (l.motivo === 'expirado') return { ok: false, expirado: true, resp: json(409, { error: 'tarjeta_expirada', message: MENSAJE_TARJETA_EXPIRADA }) }
    if (l.motivo === 'firma') { obs(accion, 'provider_error', { code: 'token_sin_firma_valida', mensaje: 'token transitorio con firma inválida o llave no disponible' }); return { ok: false, resp: json(400, { error: 'token_rechazado', message: 'La tarjeta no pudo verificarse. Vuelve a capturarla.' }) } }
    return { ok: false, resp: json(400, { error: 'token_invalido', message: 'Vuelve a capturar la tarjeta.' }) }
  }
  const reautenticar = async (motivo: string) => {
    await avanzar('failed_safe_to_retry', { error: motivo })
    await borrar3ds()
    return json(409, { error: 'reautenticar', estado: 'failed_safe_to_retry', message: MENSAJE_REAUTENTICAR })
  }

  // ── setup ───────────────────────────────────────────────────────────────────────────────────────────────────────
  if (accion === 'setup') {
    if (!estadoValido('setup') && !ESTADOS_CON_3DS.includes(intento.status)) return json(409, { error: 'estado_invalido', estado: intento.status, message: 'La verificación ya está en otro paso.' })
    const lt = await leerToken()
    if (!lt.ok) return lt.resp
    const t = lt.t
    if (!estadoValido('setup')) {
      const previa = await leer3ds()
      const re = decidirReentrada(intento.status, previa?.jti ?? null, t.jti)
      // mismo token (remontaje del componente): se informa el paso actual, como antes
      if (re === 'mismo') return json(409, { error: 'estado_invalido', estado: intento.status, message: 'La verificación ya está en otro paso.' })
      return await reautenticar('tarjeta recapturada: la autenticación previa no sirve para otra tarjeta')
    }
    let cuerpo
    try { cuerpo = buildSetupRequest(attemptId, t.jti) } catch { return json(400, { error: 'token_invalido', message: 'Vuelve a capturar la tarjeta.' }) }
    const r = await llamarCS(cfg, admin, attemptId, 'setup', { metodo: 'POST', ruta: RUTAS_CS.payerSetup, cuerpo })
    if (!r.ok) {
      if (r.clase === 'http') { obs('setup', 'provider_error', { code: r.status, mensaje: r.mensaje }); return json(r.status === 400 ? 400 : 502, { error: r.status === 400 ? 'token_rechazado' : 'proveedor', message: r.status === 400 ? 'La tarjeta no pudo verificarse. Vuelve a capturarla.' : 'No se pudo iniciar la verificación. Intenta de nuevo.' }) }
      if (r.clase === 'resultado_desconocido') { obs('setup', 'provider_error', { code: r.motivo, mensaje: r.mensaje }); return json(503, { error: 'proveedor_sin_respuesta', message: 'El banco no respondió. Intenta de nuevo en un momento.' }) }
      obs('setup', 'internal_error', { code: 'firma', mensaje: r.mensaje }); return json(500, { error: 'edge' })
    }
    const l = leerSetup(r.data)
    if (!l.ok) { obs('setup', 'provider_error', { code: l.motivo, mensaje: l.detalle }); return json(502, { error: 'contrato', message: 'No se pudo iniciar la verificación. Intenta de nuevo.' }) }
    await guardar3ds(fila3dsSetup(attemptId, t))
    if (intento.status === 'created') await avanzar('tokenized')
    await avanzar('auth_setup', { cs_auth_reference_id: l.referenceId })
    return json(200, { estado: 'auth_setup', reference_id: l.referenceId, ddc_url: l.ddcUrl, ddc_token: l.accessToken, ddc_origen: ORIGENES_DDC[cfg.ambiente], ddc_timeout_ms: 10000 })
  }

  // ── enroll ──────────────────────────────────────────────────────────────────────────────────────────────────────
  if (accion === 'enroll') {
    if (!estadoValido('enroll')) return json(409, { error: 'estado_invalido', estado: intento.status, message: 'La verificación ya está en otro paso.' })
    if (!intento.cs_auth_reference_id) return json(409, { error: 'sin_setup', message: 'Falta el paso previo de verificación.' })
    const lt = await leerToken()
    if (!lt.ok) {
      if (lt.expirado) { await avanzar('failed_safe_to_retry', { error: 'token transitorio expirado antes del enrolamiento' }); await borrar3ds() }
      return lt.resp
    }
    const previa = await leer3ds()
    if (!previa || previa.jti !== lt.t.jti) return await reautenticar('enrolamiento con un token distinto del de setup')
    // returnUrl en el dominio de la app (mismo origen que la página: su postMessage solo llega a ese origen)
    const origen = (req.headers.get('Origin') ?? '').trim()
    const ret = construirReturnUrl({ origen, origenPermitido: origenPermitido(origen, Deno.env.get, 'app'), envReturnUrl: Deno.env.get('CS_RETURN_URL') })
    if (!ret.ok) { obs('enroll', 'internal_error', { code: ret.motivo, mensaje: 'returnUrl del reto no construible' }); return json(403, { error: 'origen_no_permitido', message: 'Esta página no está autorizada para pagos con tarjeta.' }) }
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
    try { cuerpo = buildEnrollRequest({ attemptId, jti: lt.t.jti, amount, billTo: bt.billTo, referenceId: intento.cs_auth_reference_id, returnUrl: ret.url, dispositivo, movil: cliente.phone ?? address?.phone }) }
    catch { return json(400, { error: 'token_invalido', message: 'Vuelve a capturar la tarjeta.' }) }
    await avanzar('auth_pending')   // "enrolamiento solicitado" queda registrado ANTES de llamar
    const r = await llamarCS(cfg, admin, attemptId, 'enroll', { metodo: 'POST', ruta: RUTAS_CS.payerEnroll, cuerpo })
    if (!r.ok) {
      const msg = r.mensaje
      obs('enroll', r.clase === 'http' ? 'provider_error' : r.clase === 'resultado_desconocido' ? 'unknown' : 'internal_error', { code: r.clase === 'http' ? r.status : r.clase, mensaje: msg })
      // sin dinero de por medio: el intento se cierra como fallo seguro y el doctor puede empezar de nuevo
      await avanzar('failed_safe_to_retry', { error: `enroll: ${msg}` }); await borrar3ds()
      return json(r.clase === 'http' ? 502 : 503, { estado: 'failed_safe_to_retry', error: r.clase === 'http' ? 'proveedor' : 'proveedor_sin_respuesta', message: 'No se pudo verificar la tarjeta con tu banco. Intenta de nuevo.' })
    }
    const l = leerEnroll(r.data)
    if (!l.ok) { obs('enroll', 'provider_error', { code: l.motivo, mensaje: l.detalle }); await avanzar('failed_safe_to_retry', { error: `enroll: ${l.motivo}` }); await borrar3ds(); return json(502, { estado: 'failed_safe_to_retry', error: 'contrato', message: 'No se pudo verificar la tarjeta con tu banco. Intenta de nuevo.' }) }
    // Política paresStatus: Y/A cobrar · C reto · U/N/R/otro rechazo SIN cobro (mensaje §10.5)
    if (l.resultado === 'rechazada') { await avanzar('declined', { ...datosAvance(l.evidencia, 'AUTHENTICATION_FAILED'), cs_reason: l.motivo }); await borrar3ds(); return json(200, { estado: 'declined', message: MENSAJE_RECHAZO_3DS }) }
    await guardar3ds(actualizarFila3ds(previa, l.evidencia, 'enroll', marcaTarjeta(l.evidencia.cardType)))
    if (l.resultado === 'autenticada') { await avanzar('auth_validated', datosAvance(l.evidencia, 'AUTHENTICATION_SUCCESSFUL')); return json(200, { estado: 'auth_validated', reto: false }) }
    await avanzar('auth_challenge', datosAvance(l.evidencia, 'PENDING_AUTHENTICATION'))
    return json(200, { estado: 'auth_challenge', reto: true, step_up_url: l.stepUpUrl, step_up_token: l.accessToken, ventana: l.ventana, ventana_px: VENTANAS_RETO[l.ventana],
                       retorno_origen: ret.origen, authentication_transaction_id: l.evidencia.authenticationTransactionId })
  }

  // ── validate ────────────────────────────────────────────────────────────────────────────────────────────────────
  if (!estadoValido('validate')) return json(409, { error: 'estado_invalido', estado: intento.status, message: intento.status === 'auth_validated' ? 'La tarjeta ya está autenticada.' : 'La verificación no está en el paso de validación.' })
  if (!intento.cs_auth_transaction_id) return json(409, { error: 'sin_transaccion', message: 'Falta la referencia de autenticación.' })
  // El TransactionId que el banco devolvió al returnUrl debe ser el de ESTE intento.
  const txNavegador = typeof p.transaction_id === 'string' ? p.transaction_id.trim() : ''
  if (txNavegador && txNavegador !== intento.cs_auth_transaction_id) { obs('validate', 'provider_error', { code: 'transaccion_distinta', mensaje: 'TransactionId del retorno no coincide con el intento' }); return json(409, { error: 'transaccion_distinta', message: 'La respuesta de tu banco no corresponde a este pago. Intenta de nuevo.' }) }
  const previa = await leer3ds()
  if (!previa || new Date(previa.token_exp).getTime() <= Date.now()) {
    await avanzar('failed_safe_to_retry', { error: 'token transitorio expirado antes de validar el reto' }); await borrar3ds()
    return json(409, { error: 'tarjeta_expirada', estado: 'failed_safe_to_retry', message: MENSAJE_TARJETA_EXPIRADA })
  }
  let cuerpoV
  try { cuerpoV = buildValidateRequest(attemptId, intento.cs_auth_transaction_id, amount, previa.jti) } catch { return json(409, { error: 'sin_transaccion' }) }
  const rv = await llamarCS(cfg, admin, attemptId, 'validate', { metodo: 'POST', ruta: RUTAS_CS.payerValidate, cuerpo: cuerpoV })
  if (!rv.ok) {
    // validar no mueve dinero y se puede repetir: el intento se queda en auth_challenge
    if (rv.clase === 'http') { obs('validate', 'provider_error', { code: rv.status, mensaje: rv.mensaje }); return json(502, { estado: 'auth_challenge', error: 'proveedor', message: 'No se pudo confirmar la verificación. Intenta de nuevo.' }) }
    if (rv.clase === 'resultado_desconocido') { obs('validate', 'unknown', { code: rv.motivo, mensaje: rv.mensaje }); return json(503, { estado: 'auth_challenge', error: 'proveedor_sin_respuesta', message: 'El banco no respondió. Intenta de nuevo en un momento.' }) }
    obs('validate', 'internal_error', { code: 'firma', mensaje: rv.mensaje }); return json(500, { error: 'edge' })
  }
  const lv = leerValidate(rv.data)
  if (!lv.ok) { obs('validate', 'provider_error', { code: lv.motivo, mensaje: lv.detalle }); return json(502, { estado: 'auth_challenge', error: 'contrato', message: 'No se pudo confirmar la verificación. Intenta de nuevo.' }) }
  if (lv.resultado === 'pendiente') return json(200, { estado: 'auth_challenge', pendiente: true, message: 'La verificación con tu banco aún no termina.' })
  if (lv.resultado === 'rechazada') { await avanzar('declined', { ...datosAvance(lv.evidencia, 'AUTHENTICATION_FAILED'), cs_reason: lv.motivo }); await borrar3ds(); return json(200, { estado: 'declined', message: MENSAJE_RECHAZO_3DS }) }
  // manual §10.1: tras el reto, los valores 3DS del validate REEMPLAZAN a los del enroll
  await guardar3ds(actualizarFila3ds(previa, lv.evidencia, 'validate', marcaTarjeta(lv.evidencia.cardType)))
  await avanzar('auth_validated', datosAvance(lv.evidencia, 'AUTHENTICATION_SUCCESSFUL'))
  return json(200, { estado: 'auth_validated' })
}))

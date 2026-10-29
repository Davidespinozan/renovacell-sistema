// Edge Function · CS-1A.3 · Capture Context de Flex Microform v2 (CyberSource / BanBajío) para el portal del doctor.
//
// Qué hace: autentica al llamante, exige doctor dueño VERIFICADO (o Dirección), abre (o reutiliza) el INTENTO de cobro con
// `cs_intento_abrir` (CS-1A.1a: importe = saldo pendiente calculado en el servidor, una reserva por pedido), pide a CyberSource el
// capture context firmando con el cliente CS-1A.2, y devuelve al navegador SOLO lo necesario para montar Microform:
// attempt_id, importe, capture_context (JWT), URL e integridad de la librería y la expiración.
// Qué NO hace: no cobra, no autoriza, no captura, no llama a /pts/v2/payments ni a 3DS, no toca el ledger, no expone secretos
// ni cabeceras firmadas. El navegador no elige merchant, ambiente, host, importe ni redes: todo sale del servidor.
// SEAM: sin secretos CS_* responde 501 (como stripe-checkout). targetOrigins = el Origin de la página, validado contra la lista
// blanca de CORS (la misma que decide si la página puede llamarnos). Requiere JWT: desplegar SIN --no-verify-jwt.
import { RESPUESTA_APAGADO, tarjetaEnLineaActiva } from '../_shared/pagosEnLinea.ts'   // PAGOS EN LÍNEA · interruptor de Dirección
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { conCors, origenPermitido } from '../_shared/cors.ts'
import { observador } from '../_shared/observa.ts'
import { csConfig, solicitarCS, RUTAS_CS, describirCS } from '../_shared/cybersource.ts'
import { buildCaptureContextRequest, leerCaptureContext, respuestaParaNavegador, traducirErrorAbrir, ESTADOS_REEMISION_CS } from './contrato.ts'

const obs = observador('cs-capture-context')
const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const url = Deno.env.get('SUPABASE_URL')!
  const authHeader = req.headers.get('Authorization') ?? ''
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!(await tarjetaEnLineaActiva(admin))) return json(409, RESPUESTA_APAGADO)   // PAGOS EN LÍNEA · apagado por Dirección
  // Solo el doctor VERIFICADO (la verdad la pone el servidor) o Dirección. El dueño del pedido lo valida cs_intento_abrir.
  if (!(tieneRol(q.quien, ['admin']) || (q.quien.role === 'doctor' && q.quien.verified))) {
    return json(403, { error: 'no_verificado', message: 'Tu cuenta aún no está verificada por Renovacell.' })
  }

  let payload: { order_id?: string }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const orderId = String(payload.order_id ?? '')
  if (!UUID.test(orderId)) return json(400, { error: 'Falta order_id.' })

  // El origen de la página es el targetOrigin del capture context: debe estar en la lista blanca (misma que CORS).
  const origen = (req.headers.get('Origin') ?? '').trim()
  if (!origenPermitido(origen, Deno.env.get, 'app')) return json(403, { error: 'origen_no_permitido', message: 'Origen no permitido para pagos con tarjeta.' })

  // SEAM: sin credenciales de CyberSource no se prepara nada (501 en palabras; sin detalles de qué secreto falta).
  const conf = csConfig(Deno.env.get)
  if (!conf.ok) {
    if (conf.motivo === 'produccion_deshabilitada') return json(503, { error: 'produccion_deshabilitada', message: 'El pago con tarjeta en producción aún no está habilitado.' })
    return json(501, { error: 'not_configured', message: 'El pago con tarjeta aún no está disponible. Usa Transferencia.' })
  }
  const cfg = conf.cfg

  // Intento = reserva (CS-1A.1a): importe en el servidor, una por pedido; si ya hay uno activo, se reutiliza mientras no se haya enviado al banco.
  const { data: ab, error: abErr } = await caller.rpc('cs_intento_abrir', { p_order: orderId, p_ambiente: cfg.ambiente })
  if (abErr) { const t = traducirErrorAbrir(abErr.message ?? ''); if (t.status >= 500) obs('abrir', 'internal_error', { code: 'rpc_error', error: abErr }); return json(t.status, { error: t.error, message: t.message }) }
  const a = (ab ?? {}) as { status?: string; attempt_id?: string; estado?: string; amount?: number; bloqueado?: boolean }
  if (!a.attempt_id || !Number.isFinite(Number(a.amount))) return json(500, { error: 'intento', message: 'No se pudo preparar el pago con tarjeta.' })
  if (a.bloqueado) return json(409, { error: 'pendiente_verificacion', message: 'Hay un cobro con tarjeta de este pedido pendiente de verificación. Te avisamos en cuanto se resuelva.' })
  if (a.status === 'existing' && !ESTADOS_REEMISION_CS.includes(String(a.estado))) {
    return json(409, { error: 'operacion_en_curso', message: 'Hay un cobro con tarjeta de este pedido en proceso. Espera a que termine.' })
  }

  // Capture context (una sola llamada; sin reintentos). El JWT llega como TEXTO.
  let cuerpo
  try { cuerpo = buildCaptureContextRequest(origen) } catch { return json(403, { error: 'origen_no_permitido' }) }
  const r = await solicitarCS<string>(cfg, { metodo: 'POST', ruta: RUTAS_CS.captureContext, cuerpo, aceptar: 'texto' })
  if (!r.ok) {
    if (r.clase === 'http') { obs('capture_context', 'provider_error', { code: r.status, mensaje: r.mensaje }); return json(502, { error: 'proveedor', message: 'CyberSource no pudo preparar el formulario de tarjeta. Intenta de nuevo.' }) }
    if (r.clase === 'resultado_desconocido') { obs('capture_context', 'provider_error', { code: r.motivo, mensaje: r.mensaje }); return json(503, { error: 'proveedor_sin_respuesta', message: 'CyberSource no respondió. Intenta de nuevo en un momento.' }) }
    obs('capture_context', 'internal_error', { code: 'firma', mensaje: r.mensaje }); return json(500, { error: 'edge', message: 'No se pudo preparar el pago con tarjeta.' })
  }
  const lectura = leerCaptureContext(r.data, origen)
  if (!lectura.ok) { obs('capture_context', 'provider_error', { code: lectura.motivo, mensaje: `capture context ${lectura.motivo} (${describirCS(cfg)})` }); return json(502, { error: 'contrato', message: 'CyberSource devolvió un contexto no válido.' }) }

  return json(200, respuestaParaNavegador({ attempt_id: a.attempt_id, amount: Number(a.amount), ambiente: cfg.ambiente, reutilizado: a.status === 'existing' }, r.data, lectura.info))
}))

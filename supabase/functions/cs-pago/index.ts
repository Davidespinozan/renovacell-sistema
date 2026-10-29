// Edge Function · CS-1A.5 · Autorización + captura + contabilización (CyberSource / BanBajío) para el portal del doctor.
//
// Camino seguro: auth_validated → authz_sent (ANTES del banco; reconfirma el saldo) → POST /pts/v2/payments (UNA vez, sin reintentos)
//   → authorized → captura (misma llamada en modo 'venta' o POST /{id}/captures en modo 'auth_captura') → captured
//   → cs_intento_contabilizar (registrar_cobro con op_id derivado del id de pago; consume su propia reserva) → posted.
// Reglas: solo el doctor dueño verificado (o Dirección); importe, moneda y referencia salen del intento; el token transitorio solo
// se reenvía al banco; una autorización sin captura NO se contabiliza; timeout/5xx tras enviar = unknown_requires_reconciliation
// (la reserva se conserva); dos solicitudes simultáneas → la segunda recibe 'already' en authz_sent y NO llama al banco.
// La Edge no escribe en payment_entries: la contabilización es exclusivamente cs_intento_contabilizar (ledger W2).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { RESPUESTA_APAGADO, tarjetaEnLineaActiva } from '../_shared/pagosEnLinea.ts'   // PAGOS EN LÍNEA · interruptor de Dirección
import { conCors } from '../_shared/cors.ts'
import { observador } from '../_shared/observa.ts'
import { csConfig, solicitarCS, RUTAS_CS } from '../_shared/cybersource.ts'
import { buildBillTo } from '../cs-3ds/contrato.ts'
import { modoCaptura, buildPaymentRequest, leerPago, buildCaptureRequest, leerCaptura, datosAutorizacion, datosCaptura, MENSAJES_ESTADO, ESTADO_PAGABLE, ESTADOS_EN_CURSO } from './contrato.ts'

const obs = observador('cs-pago')
const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Intento = { id: string; order_id: string; doctor_id: string; ambiente: 'test' | 'production'; amount: number; status: string; cs_auth_transaction_id: string | null; cs_payment_id: string | null; entry_id: string | null }

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!(tieneRol(q.quien, ['admin']) || (q.quien.role === 'doctor' && q.quien.verified))) return json(403, { error: 'no_verificado', message: 'Tu cuenta aún no está verificada por Renovacell.' })

  let p: { accion?: string; attempt_id?: string; token?: string }
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const accion = String(p.accion ?? 'pagar')
  const attemptId = String(p.attempt_id ?? '')
  if (!UUID.test(attemptId)) return json(400, { error: 'Falta attempt_id.' })
  if (!['pagar', 'estado'].includes(accion)) return json(400, { error: 'accion_invalida' })
  if (accion === 'pagar' && !(await tarjetaEnLineaActiva(admin))) return json(409, RESPUESTA_APAGADO)   // PAGOS EN LÍNEA · apagado por Dirección (consultar el estado sigue)

  const leer = async (): Promise<Intento | null> => {
    const { data } = await caller.from('card_payment_attempts').select('id, order_id, doctor_id, ambiente, amount, status, cs_auth_transaction_id, cs_payment_id, entry_id').eq('id', attemptId).maybeSingle()
    return (data as Intento | null) ?? null
  }
  const intento = await leer()
  if (!intento) return json(404, { error: 'intento_inexistente', message: 'No encontramos este intento de pago.' })
  if (q.quien.role === 'doctor' && intento.doctor_id !== q.quien.uid) return json(403, { error: 'no_autorizado', message: 'Ese intento no es tuyo.' })
  const respuestaEstado = (estado: string, extra: Record<string, unknown> = {}) =>
    json(200, { estado, pagado: estado === 'posted', amount: Number(intento.amount), ambiente: intento.ambiente, message: MENSAJES_ESTADO[estado] ?? null, ...extra })

  const avanzar = async (estado: string, datos: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc('cs_intento_avanzar', { p_attempt: attemptId, p_estado: estado, p_datos: datos })
    if (error) { obs(accion, 'internal_error', { code: 'rpc_error', error }); throw new Error(`avanzar:${error.message}`) }
    return data as { status: string; estado: string; saldo_vigente?: number }
  }
  // Contabilizar es idempotente: si la base falló después de una captura confirmada, 'estado' lo vuelve a intentar sin tocar al banco.
  const contabilizar = async (): Promise<{ ok: true; estado: 'posted'; saldo?: number; payment_status?: string } | { ok: false }> => {
    const { data, error } = await admin.rpc('cs_intento_contabilizar', { p_attempt: attemptId })
    if (error) { obs('contabilizar', 'unknown', { code: 'rpc_error', error }); return { ok: false } }
    const d = (data ?? {}) as { status?: string; saldo?: number; payment_status?: string }
    return { ok: true, estado: 'posted', saldo: d.saldo, payment_status: d.payment_status }
  }

  // ── estado (recuperación tras recarga/cierre): nunca llama al banco ──────────────────────────────────────────────
  if (accion === 'estado') {
    if (intento.status === 'captured') { const c = await contabilizar(); return respuestaEstado(c.ok ? 'posted' : 'captured') }
    return respuestaEstado(intento.status)
  }

  // ── pagar ──────────────────────────────────────────────────────────────────────────────────────────────────────
  if (ESTADOS_EN_CURSO.includes(intento.status)) {
    // ya se envió al banco (o ya terminó): devolver el estado real, jamás un segundo cargo
    if (intento.status === 'captured') { const c = await contabilizar(); return respuestaEstado(c.ok ? 'posted' : 'captured', { repetido: true }) }
    return respuestaEstado(intento.status, { repetido: true })
  }
  if (intento.status !== ESTADO_PAGABLE) return json(409, { error: 'estado_invalido', estado: intento.status, message: 'La tarjeta aún no está autenticada. Completa la verificación primero.' })
  if (!intento.cs_auth_transaction_id) return json(409, { error: 'sin_autenticacion', message: 'Falta la referencia de autenticación.' })
  const token = typeof p.token === 'string' ? p.token : ''
  if (!token || token.split('.').length !== 3) return json(400, { error: 'token_invalido', message: 'La captura de la tarjeta caducó. Vuelve a capturarla.' })

  const conf = csConfig(Deno.env.get)
  if (!conf.ok) return json(conf.motivo === 'produccion_deshabilitada' ? 503 : 501, { error: conf.motivo === 'produccion_deshabilitada' ? 'produccion_deshabilitada' : 'not_configured', message: 'El pago con tarjeta aún no está disponible.' })
  const cfg = conf.cfg
  if (cfg.ambiente !== intento.ambiente) return json(409, { error: 'ambiente_distinto', message: 'Este intento pertenece a otro ambiente. Empieza de nuevo.' })
  const modo = modoCaptura(Deno.env.get('CS_MODO_CAPTURA'))
  const amount = Number(intento.amount)

  // Bill-to del ERP (mismo armado que en 3DS); el navegador no manda nada de esto.
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
  if (!bt.ok) return json(409, { error: 'datos_incompletos', faltan: bt.faltan, message: 'Faltan datos de facturación del pedido.' })
  let cuerpo
  try { cuerpo = buildPaymentRequest({ attemptId, amount, token, authenticationTransactionId: intento.cs_auth_transaction_id, billTo: bt.billTo, modo }) }
  catch (e) { return json(400, { error: 'solicitud_invalida', message: (e as Error).message }) }

  // 1) authz_sent ANTES de llamar: reconfirma el saldo bajo bloqueo; una segunda solicitud simultánea recibe 'already' y NO llama al banco.
  const envio = await avanzar('authz_sent')
  if (envio.status === 'amount_changed') return json(409, { error: 'importe_cambio', estado: 'amount_changed', saldo_vigente: envio.saldo_vigente, message: MENSAJES_ESTADO.amount_changed })
  if (envio.status === 'already') return json(409, { error: 'en_proceso', estado: 'authz_sent', message: 'Tu pago ya se está procesando. No lo envíes de nuevo.' })

  // 2) autorización (o venta) — UNA llamada, sin reintentos. Desde aquí, cualquier incertidumbre = conciliación.
  const r = await solicitarCS(cfg, { metodo: 'POST', ruta: RUTAS_CS.pagos, cuerpo })
  if (!r.ok) {
    if (r.clase === 'http' && r.status >= 400 && r.status < 500) {
      // rechazo explícito del proveedor antes de procesar: sin cargo
      obs('pagar', 'provider_error', { code: r.status, mensaje: r.mensaje })
      await avanzar('declined', { cs_reason: r.mensaje.slice(0, 120), error: r.mensaje })
      return respuestaEstado('declined', { detalle: r.mensaje })
    }
    obs('pagar', 'unknown', { code: r.clase === 'http' ? r.status : r.clase, mensaje: r.mensaje })
    await avanzar('unknown_requires_reconciliation', { error: `autorización: ${r.mensaje}` })
    return respuestaEstado('unknown_requires_reconciliation')
  }
  const lp = leerPago(r.data)
  if (lp.resultado === 'rechazada') { await avanzar('declined', { ...datosAutorizacion(lp.evidencia, false), cs_reason: lp.motivo.slice(0, 120) }); return respuestaEstado('declined', { detalle: lp.motivo }) }
  if (lp.resultado !== 'autorizada') {
    obs('pagar', 'unknown', { code: lp.evidencia.status ?? 'sin_status', mensaje: lp.motivo })
    await avanzar('unknown_requires_reconciliation', { ...datosAutorizacion(lp.evidencia, false), error: lp.motivo })
    return respuestaEstado('unknown_requires_reconciliation')
  }
  await avanzar('authorized', datosAutorizacion(lp.evidencia, modo === 'venta'))

  // 3) captura
  if (modo === 'venta') {
    await avanzar('captured', { cs_payment_status: 'AUTHORIZED+CAPTURE' })
  } else {
    const rc = await solicitarCS(cfg, { metodo: 'POST', ruta: `${RUTAS_CS.pagos}/${encodeURIComponent(lp.evidencia.id!)}/captures`, cuerpo: buildCaptureRequest(attemptId, amount) })
    if (!rc.ok) {
      if (rc.clase === 'http' && rc.status >= 400 && rc.status < 500) {
        // autorizada pero NO capturada: queda `authorized` (retención en el banco, sin asiento). La resuelve conciliación (captura o reversa).
        obs('capturar', 'provider_error', { code: rc.status, mensaje: rc.mensaje })
        return respuestaEstado('authorized', { detalle: rc.mensaje })
      }
      obs('capturar', 'unknown', { code: rc.clase === 'http' ? rc.status : rc.clase, mensaje: rc.mensaje })
      await avanzar('unknown_requires_reconciliation', { error: `captura: ${rc.mensaje}` })
      return respuestaEstado('unknown_requires_reconciliation')
    }
    const lc = leerCaptura(rc.data)
    if (lc.resultado !== 'capturada') { obs('capturar', 'unknown', { code: 'forma', mensaje: lc.motivo }); await avanzar('unknown_requires_reconciliation', { error: `captura: ${lc.motivo}` }); return respuestaEstado('unknown_requires_reconciliation') }
    await avanzar('captured', datosCaptura(lc))
  }

  // 4) contabilizar (idempotente). Si falla la base, el intento queda `captured` con la evidencia y 'estado' lo completa después.
  const c = await contabilizar()
  return respuestaEstado(c.ok ? 'posted' : 'captured', c.ok ? { saldo: c.saldo, payment_status: c.payment_status } : {})
}))

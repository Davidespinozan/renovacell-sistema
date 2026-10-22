// Edge Function · CS-1A.6/CS-1A.7 · Conciliación y recuperación de cobros con tarjeta (solo Dirección y Facturación).
//
// Acciones (POST JSON {accion, attempt_id, motivo?, business_center_revisado?}):
//   consultar      solo lectura al proveedor (GET /tss/v2/transactions/{id} o POST /tss/v2/searches por referencia); no cambia nada.
//   resolver       consulta y aplica la resolución DERIVADA de lo que dice el proveedor (captured → contabiliza; authorized; declined).
//                  El operador no elige el estado. Sin transacciones = sin cambio (la reserva se conserva); un envío sin respuesta
//                  registrada pasa a desconocido solo cuando ya no puede estar en vuelo.
//   capturar       desde `authorized`, tras consultar que NO exista ya una captura: POST /pts/v2/payments/{id}/captures → captured → contabiliza.
//   reversar       desde `authorized`, tras consultar que NO exista captura: POST /pts/v2/payments/{id}/reversals → REVERSED → declined.
//                  Reversa con timeout = unknown (NO libera la reserva).
//   contabilizar   desde `captured` (reintento tras un fallo de base): cs_intento_contabilizar, idempotente.
//   cerrar_manual  CS-1A.7 · desde `unknown_requires_reconciliation`, acción separada y humana: ≥ 24 h, consulta por id (si existe) y por
//                  referencia realizadas AHORA y sin transacciones, Business Center revisado (declarado), motivo ≥ 10 y responsable.
//                  Si una consulta falla, está incompleta o encuentra algo, NO se cierra. La base vuelve a validar todo (cs_intento_cerrar_manual).
// Invariantes: ningún reenvío de autorización; ninguna captura sin comprobar que no existe otra; un pago = un asiento (ledger);
// toda transición va por cs_intento_avanzar / cs_intento_cerrar_manual CON EL JWT DEL OPERADOR (su uid queda como actor en la
// bitácora) y lleva motivo+evidencia; una persona entra a authorized/captured solo con los hechos del proveedor (`proveedor`).
// Nunca se deriva un "fallo seguro": una búsqueda vacía o el tiempo transcurrido no demuestran ausencia de cargo.
// Los estados terminales (posted, declined, expired…) no se tocan. Sin secretos ni datos de tarjeta en respuestas/logs.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { conCors } from '../_shared/cors.ts'
import { observador } from '../_shared/observa.ts'
import { csConfig, solicitarCS, RUTAS_CS, depurarCS } from '../_shared/cybersource.ts'
import { buildCaptureRequest, leerCaptura, datosCaptura } from '../cs-pago/contrato.ts'
import {
  leerTransaccion, leerBusqueda, buildBusqueda, resumirHallazgo, decidirResolucion, buildReversalRequest, leerReversa, ESTADOS_CONCILIACION, textoEvidencia,
  HORAS_MINIMAS_CIERRE, MOTIVO_MINIMO_CIERRE, MINUTOS_ENVIO_EN_VUELO, horasParaCierre, buildConsultaCierre, type Hallazgo, type ConsultaCierre,
} from './contrato.ts'

const obs = observador('cs-conciliar')
const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Intento = { id: string; order_id: string; ambiente: 'test' | 'production'; amount: number; status: string; status_at: string | null; cs_payment_id: string | null; cs_request_sent_at: string | null; entry_id: string | null }

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!tieneRol(q.quien, ['admin', 'billing'])) return json(403, { error: 'no_autorizado', message: 'Solo Dirección y Facturación concilian cobros con tarjeta.' })
  const operador = `${q.quien.role}:${q.quien.uid.slice(0, 8)}`

  let p: { accion?: string; attempt_id?: string; motivo?: string; business_center_revisado?: unknown }
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const accion = String(p.accion ?? '') as keyof typeof ESTADOS_CONCILIACION
  const attemptId = String(p.attempt_id ?? '')
  const motivo = String(p.motivo ?? '').replace(/\s+/g, ' ').trim()
  if (!UUID.test(attemptId)) return json(400, { error: 'Falta attempt_id.' })
  if (!(accion in ESTADOS_CONCILIACION)) return json(400, { error: 'accion_invalida' })
  if (accion !== 'consultar' && accion !== 'contabilizar' && motivo.length < 5) return json(400, { error: 'motivo_requerido', message: 'Escribe el motivo de la conciliación (mínimo 5 caracteres).' })
  if (accion === 'cerrar_manual' && motivo.length < MOTIVO_MINIMO_CIERRE) return json(400, { error: 'motivo_requerido', message: `El cierre manual exige un motivo de al menos ${MOTIVO_MINIMO_CIERRE} caracteres.` })
  if (accion === 'cerrar_manual' && p.business_center_revisado !== true) return json(400, { error: 'revision_requerida', message: 'Confirma que revisaste el Business Center de CyberSource y no existe ninguna transacción de este intento.' })

  // El intento se lee con el JWT del operador (RLS: admin/billing ven todos).
  const { data: a } = await caller.from('card_payment_attempts').select('id, order_id, ambiente, amount, status, status_at, cs_payment_id, cs_request_sent_at, entry_id').eq('id', attemptId).maybeSingle()
  if (!a) return json(404, { error: 'intento_inexistente' })
  const intento = a as Intento
  if (!ESTADOS_CONCILIACION[accion].includes(intento.status)) return json(409, { error: 'estado_invalido', estado: intento.status, message: `"${accion}" no aplica a un intento en ${intento.status}.` })
  const amount = Number(intento.amount)
  const horas = horasParaCierre(intento)
  // El cierre manual no toca al proveedor si todavía no procede: 24 h es el mínimo para que la consulta sea creíble, no una evidencia.
  if (accion === 'cerrar_manual' && (horas == null || horas < HORAS_MINIMAS_CIERRE)) return json(409, { error: 'cierre_prematuro', estado: intento.status, horas: horas == null ? null : Math.floor(horas * 10) / 10, message: `El cierre manual exige ${HORAS_MINIMAS_CIERRE} h desde el envío al banco y desde que quedó desconocido.` })

  // Transiciones CON el JWT del operador: el actor queda en la bitácora; la máquina de estados sigue en la base.
  const avanzar = async (estado: string, datos: Record<string, unknown>) => {
    const { data, error } = await caller.rpc('cs_intento_avanzar', { p_attempt: attemptId, p_estado: estado, p_datos: datos })
    if (error) { obs(accion, 'internal_error', { code: 'rpc_error', error }); throw new Error(`avanzar:${error.message}`) }
    return data as { status: string; estado: string }
  }
  const contabilizar = async () => {
    const { data, error } = await caller.rpc('cs_intento_contabilizar', { p_attempt: attemptId })
    if (error) { obs('contabilizar', 'unknown', { code: 'rpc_error', error }); return { ok: false as const, mensaje: depurarCS(error.message, 120) } }
    return { ok: true as const, data: data as { status: string; entry_id?: string; como?: string; saldo?: number; payment_status?: string } }
  }

  if (accion === 'contabilizar') {
    const c = await contabilizar()
    return c.ok ? json(200, { estado: 'posted', ...c.data }) : json(409, { estado: 'captured', error: 'contabilizacion_fallida', message: c.mensaje })
  }

  const conf = csConfig(Deno.env.get)
  if (!conf.ok) return json(conf.motivo === 'produccion_deshabilitada' ? 503 : 501, { error: conf.motivo === 'produccion_deshabilitada' ? 'produccion_deshabilitada' : 'not_configured', message: 'CyberSource no está configurado en este ambiente.' })
  const cfg = conf.cfg
  if (cfg.ambiente !== intento.ambiente) return json(409, { error: 'ambiente_distinto', message: 'El intento pertenece a otro ambiente.' })

  // ── consulta al proveedor (solo lectura) ────────────────────────────────────────────────────────────────────────
  //   por id (si lo tenemos): GET /tss/v2/transactions/{id}; 404 = no encontrada. Por referencia: POST /tss/v2/searches.
  //   `ambas`: el cierre manual exige las DOS consultas realizadas y completas; cualquier error del proveedor impide cerrar.
  type Consulta = { ok: true; hallazgo: Hallazgo; por_id: ConsultaCierre['por_id'] } | { ok: false; status: number; body: unknown }
  const consultar = async (ambas: boolean): Promise<Consulta> => {
    let porId: ConsultaCierre['por_id'] = { realizada: false, motivo: 'sin_id' }
    let txsId: ReturnType<typeof leerTransaccion>[] = []
    if (intento.cs_payment_id) {
      const r = await solicitarCS(cfg, { metodo: 'GET', ruta: RUTAS_CS.transaccion(intento.cs_payment_id) })
      if (r.ok) { porId = { realizada: true, resultado: 'encontrada' }; txsId = [leerTransaccion(r.data)] }
      else if (r.clase === 'http' && r.status === 404) porId = { realizada: true, resultado: 'no_encontrada' }
      else if (r.clase === 'http') { obs('consultar', 'provider_error', { code: r.status, mensaje: r.mensaje }); return { ok: false, status: 502, body: { error: 'proveedor', message: 'CyberSource no pudo devolver la transacción.' } } }
      else { obs('consultar', 'provider_error', { code: r.clase, mensaje: r.mensaje }); return { ok: false, status: 503, body: { error: 'proveedor_sin_respuesta', message: 'CyberSource no respondió a la consulta.' } } }
      if (porId.realizada && porId.resultado === 'encontrada' && !ambas) return { ok: true, hallazgo: resumirHallazgo(txsId, attemptId, amount), por_id: porId }
    }
    const rb = await solicitarCS(cfg, { metodo: 'POST', ruta: RUTAS_CS.busqueda, cuerpo: buildBusqueda(attemptId) })
    if (!rb.ok) { obs('consultar', 'provider_error', { code: rb.clase === 'http' ? rb.status : rb.clase, mensaje: rb.mensaje }); return { ok: false, status: rb.clase === 'http' ? 502 : 503, body: { error: rb.clase === 'http' ? 'proveedor' : 'proveedor_sin_respuesta', message: 'CyberSource no pudo responder la búsqueda.' } } }
    const txsRef = leerBusqueda(rb.data)
    const vistos = new Set(txsId.map((t) => t.id))
    return { ok: true, hallazgo: resumirHallazgo([...txsId, ...txsRef.filter((t) => !t.id || !vistos.has(t.id))], attemptId, amount), por_id: porId }
  }
  const c = await consultar(accion === 'cerrar_manual')
  if (!c.ok) return json(c.status, c.body)
  const h = c.hallazgo
  const minutos = intento.cs_request_sent_at ? (Date.now() - new Date(intento.cs_request_sent_at).getTime()) / 60000 : null

  if (accion === 'consultar') return json(200, { estado: intento.status, hallazgo: h, sugerencia: decidirResolucion(h, intento.status), horas: horas == null ? null : Math.floor(horas * 10) / 10, cierre_manual_posible: intento.status === 'unknown_requires_reconciliation' && h.transacciones === 0 && horas != null && horas >= HORAS_MINIMAS_CIERRE })

  // ── cerrar_manual: decisión humana con las dos consultas hechas ahora mismo y sin hallazgos ───────────────────────
  if (accion === 'cerrar_manual') {
    if (h.transacciones > 0 || (c.por_id.realizada && c.por_id.resultado === 'encontrada')) return json(409, { error: 'hallazgos_existen', estado: intento.status, hallazgo: h, message: 'El proveedor sí registra transacciones de este intento: usa "resolver". No se cierra.' })
    const consulta = buildConsultaCierre(c.por_id, h, operador)
    const { data, error } = await caller.rpc('cs_intento_cerrar_manual', { p_attempt: attemptId, p_motivo: motivo, p_consulta: consulta })
    if (error) { obs('cerrar_manual', 'unknown', { code: 'rpc_error', error }); return json(409, { error: 'cierre_rechazado', estado: intento.status, hallazgo: h, message: depurarCS(error.message, 160) }) }
    const r = data as { status: string; estado: string; horas?: number }
    return json(200, { estado: 'failed_safe_to_retry', aplicado: r.status === 'applied', hallazgo: h, consulta, message: r.status === 'applied' ? `Cerrado sin cargo por ${operador} tras ${r.horas ?? Math.floor(horas! * 10) / 10} h; la reserva quedó liberada.` : 'Ya estaba cerrado.' })
  }

  // ── resolver: aplica la resolución derivada ────────────────────────────────────────────────────────────────────
  if (accion === 'resolver') {
    const d = decidirResolucion(h, intento.status)
    const evidencia = textoEvidencia(operador, motivo, h, d.motivo)
    if (d.accion === 'sin_cambio') {
      // un envío sin respuesta registrada que ya no puede estar en vuelo se hace visible como desconocido (conserva la reserva)
      if (intento.status === 'authz_sent' && h.transacciones === 0 && minutos != null && minutos >= MINUTOS_ENVIO_EN_VUELO) {
        await avanzar('unknown_requires_reconciliation', { error: 'envío sin respuesta registrada', evidencia })
        return json(200, { estado: 'unknown_requires_reconciliation', aplicado: true, hallazgo: h, message: `${d.motivo} · el envío sin respuesta queda como resultado desconocido` })
      }
      return json(200, { estado: intento.status, aplicado: false, hallazgo: h, message: d.motivo })
    }
    if (d.accion === 'captured') {
      if (intento.status !== 'captured') await avanzar('captured', { cs_payment_id: d.cs_payment_id, cs_payment_status: d.cs_payment_status, cs_reconciliation_id: d.cs_reconciliation_id ?? undefined, evidencia, proveedor: h })
      const cc = await contabilizar()
      return cc.ok ? json(200, { estado: 'posted', aplicado: true, hallazgo: h, ...cc.data }) : json(409, { estado: 'captured', aplicado: true, hallazgo: h, error: 'contabilizacion_fallida', message: cc.mensaje })
    }
    if (d.accion === 'authorized') { const r = await avanzar('authorized', { cs_payment_id: d.cs_payment_id, evidencia, proveedor: h }); return json(200, { estado: 'authorized', aplicado: r.status === 'applied', hallazgo: h, message: d.motivo }) }
    await avanzar('declined', { cs_payment_id: d.cs_payment_id ?? undefined, cs_reason: d.motivo.slice(0, 120), evidencia, proveedor: h })
    return json(200, { estado: 'declined', aplicado: true, hallazgo: h, message: d.motivo })
  }

  // ── capturar / reversar: solo desde authorized y solo si el proveedor NO muestra captura ya existente ──────────
  if (!intento.cs_payment_id) return json(409, { error: 'sin_id_pago' })
  if (h.captura.estado !== 'ninguna') return json(409, { error: 'captura_existente', hallazgo: h, message: 'El proveedor ya registra una captura para este intento: usa "resolver".' })
  if (h.reversa.estado === 'aprobada') return json(409, { error: 'ya_reversada', hallazgo: h, message: 'La autorización ya fue reversada: usa "resolver".' })

  if (accion === 'capturar') {
    const rc = await solicitarCS(cfg, { metodo: 'POST', ruta: `${RUTAS_CS.pagos}/${encodeURIComponent(intento.cs_payment_id)}/captures`, cuerpo: buildCaptureRequest(attemptId, amount) })
    if (!rc.ok) {
      if (rc.clase === 'http' && rc.status >= 400 && rc.status < 500) { obs('capturar', 'provider_error', { code: rc.status, mensaje: rc.mensaje }); return json(409, { estado: 'authorized', error: 'captura_rechazada', message: 'CyberSource rechazó la captura; la autorización sigue vigente.' }) }
      obs('capturar', 'unknown', { code: rc.clase === 'http' ? rc.status : rc.clase, mensaje: rc.mensaje })
      await avanzar('unknown_requires_reconciliation', { error: `captura: ${rc.mensaje}`, evidencia: textoEvidencia(operador, motivo, h, 'captura sin respuesta') })
      return json(200, { estado: 'unknown_requires_reconciliation', message: 'La captura no obtuvo respuesta: vuelve a consultar antes de cualquier otra acción.' })
    }
    const lc = leerCaptura(rc.data)
    if (lc.resultado !== 'capturada') { await avanzar('unknown_requires_reconciliation', { error: `captura: ${lc.motivo}`, evidencia: textoEvidencia(operador, motivo, h, lc.motivo) }); return json(200, { estado: 'unknown_requires_reconciliation', message: 'Respuesta de captura no reconocida: conciliar.' }) }
    // la captura la respondió el banco ahora mismo: los hechos del proveedor son esa respuesta (id de la captura aceptada)
    await avanzar('captured', { ...datosCaptura(lc), evidencia: textoEvidencia(operador, motivo, h, `captura ${lc.status} id ${lc.id}`), proveedor: { ...h, autorizacion: { ...h.autorizacion, estado: 'aprobada', id: intento.cs_payment_id }, captura: { estado: 'aprobada', id: lc.id, status: lc.status, reconciliationId: lc.reconciliationId } } })
    const cc = await contabilizar()
    return cc.ok ? json(200, { estado: 'posted', ...cc.data }) : json(409, { estado: 'captured', error: 'contabilizacion_fallida', message: cc.mensaje })
  }

  // reversar
  const rr = await solicitarCS(cfg, { metodo: 'POST', ruta: `${RUTAS_CS.pagos}/${encodeURIComponent(intento.cs_payment_id)}/reversals`, cuerpo: buildReversalRequest(attemptId, amount, motivo) })
  if (!rr.ok) {
    if (rr.clase === 'http' && rr.status >= 400 && rr.status < 500) { obs('reversar', 'provider_error', { code: rr.status, mensaje: rr.mensaje }); return json(409, { estado: 'authorized', error: 'reversa_rechazada', message: 'CyberSource rechazó la reversa; la autorización sigue vigente.' }) }
    obs('reversar', 'unknown', { code: rr.clase === 'http' ? rr.status : rr.clase, mensaje: rr.mensaje })
    await avanzar('unknown_requires_reconciliation', { error: `reversa: ${rr.mensaje}`, evidencia: textoEvidencia(operador, motivo, h, 'reversa sin respuesta: la reserva se conserva') })
    return json(200, { estado: 'unknown_requires_reconciliation', message: 'La reversa no obtuvo respuesta; la reserva se conserva hasta conciliar.' })
  }
  const lr = leerReversa(rr.data)
  if (!lr.ok) { await avanzar('unknown_requires_reconciliation', { error: `reversa: ${lr.motivo}`, evidencia: textoEvidencia(operador, motivo, h, lr.motivo) }); return json(200, { estado: 'unknown_requires_reconciliation', message: 'Respuesta de reversa no reconocida; la reserva se conserva.' }) }
  await avanzar('declined', { cs_payment_status: 'REVERSED', cs_reason: `reversal:${lr.id}`, evidencia: textoEvidencia(operador, motivo, h, `reversa REVERSED id ${lr.id}`) })
  return json(200, { estado: 'declined', message: 'Autorización reversada; la reserva quedó liberada.' })
}))

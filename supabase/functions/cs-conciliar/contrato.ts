// CS-1A.6 · Conciliación y recuperación · contratos puros (sin Deno ni red; probados desde vitest).
//
// Contratos oficiales (modelos del cliente oficial de CyberSource):
//   GET  /tss/v2/transactions/{id}  → { id, status, reconciliationId, applicationInformation { status, reasonCode, rCode, rFlag,
//        applications[ { name, status, reasonCode, rCode ('1' ok | '0' rechazada | '-1' error), rFlag, rMessage, reconciliationId } ] },
//        clientReferenceInformation { code }, orderInformation { amountDetails { totalAmount, currency } }, submitTimeUtc }
//        Aplicaciones relevantes: ics_auth (autorización), ics_bill (captura), ics_auth_reversal (reversa de autorización), ics_void (anulación).
//   POST /tss/v2/searches { query: 'clientReferenceInformation.code:<ref>', limit, sort } → { totalCount, _embedded.transactionSummaries[ {id, status,
//        submitTimeUtc, applicationInformation{…}, clientReferenceInformation{code}, orderInformation{amountDetails}} ] }
//   POST /pts/v2/payments/{id}/reversals { clientReferenceInformation.code, reversalInformation { amountDetails{totalAmount}, reason } } → { id, status: REVERSED }
//   POST /pts/v2/payments/{id}/captures (ya en CS-1A.5) → { id, status: PENDING | TRANSMITTED }
// Semántica (verificada): AUTHORIZED = autorización aprobada (fondos retenidos). Captura PENDING = CyberSource recibió la captura y espera
// el lote diario; TRANSMITTED = el lote ya se envió al procesador. Ninguno es liquidación bancaria: `captured` significa "captura ACEPTADA
// por CyberSource", que es la evidencia con la que se registra la venta (como hace el webhook de Stripe); la liquidación se concilia
// después contra el reporte del banco. Una captura rechazada en el lote aparece aquí con rCode '0' / rFlag distinto de SOK.
// Nada aquí decide por "estado operador": las resoluciones se DERIVAN de lo que responde el proveedor.

export type EstadoApp = 'aprobada' | 'rechazada' | 'error' | 'desconocido'
export interface AppT { nombre: string; estado: EstadoApp; rFlag: string | null; reasonCode: string | null; status: string | null; reconciliationId: string | null; rMessage: string | null }
export interface TransaccionCS { id: string | null; referencia: string | null; importe: number | null; moneda: string | null; submitTimeUtc: string | null; status: string | null; apps: AppT[] }

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null)
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : null }
function estadoApp(a: Record<string, unknown>): EstadoApp {
  const rCode = s(a.rCode), rFlag = (s(a.rFlag) ?? '').toUpperCase()
  if (rCode === '1' || rFlag === 'SOK') return 'aprobada'
  if (rCode === '0' || /^(D|SERR_?DECL)/.test(rFlag) || rFlag.includes('DECLIN') || rFlag.includes('REJECT')) return 'rechazada'
  if (rCode === '-1' || rFlag.startsWith('E')) return 'error'
  return 'desconocido'
}
export function leerTransaccion(data: unknown): TransaccionCS {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const ai = (d.applicationInformation && typeof d.applicationInformation === 'object' ? d.applicationInformation : {}) as Record<string, unknown>
  const apps = Array.isArray(ai.applications) ? (ai.applications as Array<Record<string, unknown>>).filter((a) => a && typeof a === 'object').map((a) => ({
    nombre: (s(a.name) ?? '').toLowerCase(), estado: estadoApp(a), rFlag: s(a.rFlag), reasonCode: s(a.reasonCode), status: s(a.status), reconciliationId: s(a.reconciliationId), rMessage: s(a.rMessage),
  })) : []
  const cri = (d.clientReferenceInformation && typeof d.clientReferenceInformation === 'object' ? d.clientReferenceInformation : {}) as Record<string, unknown>
  const oi = (d.orderInformation && typeof d.orderInformation === 'object' ? d.orderInformation : {}) as Record<string, unknown>
  const ad = (oi.amountDetails && typeof oi.amountDetails === 'object' ? oi.amountDetails : {}) as Record<string, unknown>
  return { id: s(d.id), referencia: s(cri.code), importe: n(ad.totalAmount), moneda: s(ad.currency), submitTimeUtc: s(d.submitTimeUtc), status: s(d.status), apps }
}
export function leerBusqueda(data: unknown): TransaccionCS[] {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const emb = (d._embedded && typeof d._embedded === 'object' ? d._embedded : {}) as Record<string, unknown>
  const lista = Array.isArray(emb.transactionSummaries) ? emb.transactionSummaries : []
  return lista.map((t) => leerTransaccion(t))
}
export function buildBusqueda(attemptId: string): { query: string; limit: number; sort: string; timezone: 'UTC' } {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) throw new Error('referencia inválida')
  return { query: `clientReferenceInformation.code:${attemptId}`, limit: 50, sort: 'submitTimeUtc:desc', timezone: 'UTC' }
}

/** Lo que el proveedor dice de ESTE intento, reducido a hechos comprobables. */
export interface Hallazgo {
  autorizacion: { estado: EstadoApp | 'ninguna'; id: string | null; reasonCode: string | null }
  captura: { estado: EstadoApp | 'ninguna'; id: string | null; status: string | null; reconciliationId: string | null }
  reversa: { estado: EstadoApp | 'ninguna'; id: string | null }
  anulacion: { estado: EstadoApp | 'ninguna'; id: string | null }
  importe_coincide: boolean | null
  referencia_coincide: boolean
  transacciones: number
}
export function resumirHallazgo(txs: TransaccionCS[], attemptId: string, importeEsperado: number): Hallazgo {
  const h: Hallazgo = { autorizacion: { estado: 'ninguna', id: null, reasonCode: null }, captura: { estado: 'ninguna', id: null, status: null, reconciliationId: null }, reversa: { estado: 'ninguna', id: null }, anulacion: { estado: 'ninguna', id: null }, importe_coincide: null, referencia_coincide: false, transacciones: txs.length }
  const rango: Record<EstadoApp | 'ninguna', number> = { ninguna: 0, desconocido: 1, error: 2, rechazada: 3, aprobada: 4 }
  const mejor = (actual: EstadoApp | 'ninguna', nuevo: EstadoApp) => (rango[nuevo] > rango[actual] ? nuevo : actual)
  for (const t of txs) {
    if (t.referencia && t.referencia !== attemptId) continue   // nunca mezclar transacciones de otro intento
    if (t.referencia === attemptId) h.referencia_coincide = true
    if (t.importe != null) h.importe_coincide = (h.importe_coincide ?? true) && Math.abs(t.importe - importeEsperado) < 0.005
    for (const a of t.apps) {
      if (a.nombre === 'ics_auth') { if (rango[a.estado] >= rango[h.autorizacion.estado]) h.autorizacion = { estado: a.estado, id: t.id, reasonCode: a.reasonCode } }
      else if (a.nombre === 'ics_bill') { if (rango[a.estado] >= rango[h.captura.estado]) h.captura = { estado: a.estado, id: t.id, status: a.status, reconciliationId: a.reconciliationId } }
      else if (a.nombre === 'ics_auth_reversal') h.reversa = { estado: mejor(h.reversa.estado, a.estado), id: t.id }
      else if (a.nombre === 'ics_void') h.anulacion = { estado: mejor(h.anulacion.estado, a.estado), id: t.id }
    }
  }
  return h
}

/** Resolución DERIVADA del hallazgo (el operador no elige el estado).
 *  CS-1A.7: NUNCA deriva un "fallo seguro". Una búsqueda vacía no demuestra ausencia de cargo (indexación rezagada, envío sin
 *  nuestra referencia) y el tiempo transcurrido tampoco: sin transacciones = sin cambio, la reserva se conserva, y el único
 *  cierre sin cargo es la acción separada `cerrar_manual` (≥ 24 h, consultas por id y referencia, Business Center, motivo). */
export type Resolucion =
  | { accion: 'captured'; cs_payment_id: string; cs_payment_status: string; cs_reconciliation_id: string | null; motivo: string }
  | { accion: 'authorized'; cs_payment_id: string; motivo: string }
  | { accion: 'declined'; cs_payment_id: string | null; motivo: string }
  | { accion: 'sin_cambio'; motivo: string }
export const SIN_TRANSACCIONES = 'sin transacciones con esta referencia en el proveedor: una búsqueda vacía no demuestra que no hubo cargo; la reserva se conserva. Si persiste, usa el cierre manual (≥ 24 h, revisión en Business Center)'
export function decidirResolucion(h: Hallazgo, estadoActual: string): Resolucion {
  if (h.transacciones > 0 && !h.referencia_coincide) return { accion: 'sin_cambio', motivo: 'las transacciones encontradas no llevan la referencia de este intento' }
  if (h.importe_coincide === false) return { accion: 'sin_cambio', motivo: 'el importe en el proveedor no coincide con el del intento: revisión manual' }
  if (h.anulacion.estado === 'aprobada') return { accion: 'declined', cs_payment_id: h.captura.id ?? h.autorizacion.id, motivo: 'captura anulada (ics_void aprobada) en el proveedor' }
  if (h.reversa.estado === 'aprobada') return { accion: 'declined', cs_payment_id: h.autorizacion.id, motivo: 'autorización reversada (ics_auth_reversal aprobada) en el proveedor' }
  if (h.captura.estado === 'aprobada' && h.captura.id) return { accion: 'captured', cs_payment_id: h.autorizacion.id ?? h.captura.id, cs_payment_status: `CAPTURE_${h.captura.status ?? 'PENDING'}`, cs_reconciliation_id: h.captura.reconciliationId, motivo: 'captura aceptada por el proveedor (ics_bill aprobada)' }
  if (h.captura.estado === 'rechazada' || h.captura.estado === 'error') {
    if (h.autorizacion.estado === 'aprobada' && h.autorizacion.id) return { accion: 'authorized', cs_payment_id: h.autorizacion.id, motivo: `captura ${h.captura.estado} en el proveedor; la autorización sigue vigente` }
    return { accion: 'sin_cambio', motivo: `captura ${h.captura.estado} sin autorización aprobada: revisión manual` }
  }
  if (h.autorizacion.estado === 'aprobada' && h.autorizacion.id) {
    if (estadoActual === 'authorized') return { accion: 'sin_cambio', motivo: 'autorización vigente sin captura: decide capturar o reversar' }
    return { accion: 'authorized', cs_payment_id: h.autorizacion.id, motivo: 'autorización aprobada sin captura en el proveedor' }
  }
  if (h.autorizacion.estado === 'rechazada') return { accion: 'declined', cs_payment_id: h.autorizacion.id, motivo: `autorización rechazada en el proveedor (reasonCode ${h.autorizacion.reasonCode ?? '?'})` }
  if (h.transacciones === 0) return { accion: 'sin_cambio', motivo: SIN_TRANSACCIONES }
  return { accion: 'sin_cambio', motivo: 'resultado ambiguo en el proveedor: revisión manual' }
}

export interface ReversalRequest { clientReferenceInformation: { code: string }; reversalInformation: { amountDetails: { totalAmount: string }; reason: string } }
export function buildReversalRequest(attemptId: string, amount: number, motivo: string): ReversalRequest {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('importe inválido')
  return { clientReferenceInformation: { code: attemptId }, reversalInformation: { amountDetails: { totalAmount: amount.toFixed(2) }, reason: motivo.replace(/[^\w .,:-]/g, '').slice(0, 60) || 'conciliacion' } }
}
export type LecturaReversa = { ok: true; id: string; status: 'REVERSED' } | { ok: false; motivo: string }
export function leerReversa(data: unknown): LecturaReversa {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const id = s(d.id), status = s(d.status)
  if (id && status === 'REVERSED') return { ok: true, id, status: 'REVERSED' }
  return { ok: false, motivo: `status=${status ?? 'ninguno'}${id ? '' : ' sin id'}` }
}

/** Estados en los que cada acción administrativa es válida. */
export const ESTADOS_CONCILIACION: Record<'consultar' | 'resolver' | 'capturar' | 'reversar' | 'contabilizar' | 'cerrar_manual', readonly string[]> = {
  consultar: ['authz_sent', 'authorized', 'captured', 'unknown_requires_reconciliation', 'posted', 'declined'],
  resolver: ['authz_sent', 'unknown_requires_reconciliation', 'authorized', 'captured'],
  capturar: ['authorized'],
  reversar: ['authorized'],
  contabilizar: ['captured'],
  cerrar_manual: ['unknown_requires_reconciliation'],
}
/** CS-1A.7 · cierre manual: parámetros y evidencia estructurada de la consulta (la valida también la base en cs_intento_cerrar_manual). */
export const HORAS_MINIMAS_CIERRE = 24
export const MOTIVO_MINIMO_CIERRE = 10
/** Un envío al banco sin respuesta registrada se considera "desconocido" solo cuando ya no puede estar en vuelo (timeout financiero 30 s + margen). */
export const MINUTOS_ENVIO_EN_VUELO = 5
export interface ConsultaCierre {
  consultado_en: string
  por_id: { realizada: true; resultado: 'no_encontrada' | 'encontrada' } | { realizada: false; motivo: string }
  por_referencia: { realizada: true; transacciones: number }
  business_center_revisado: true
  operador: string
}
export function horasDesde(cuando: string | null, ahora = Date.now()): number | null {
  if (!cuando) return null
  const t = new Date(cuando).getTime()
  return Number.isFinite(t) ? (ahora - t) / 3600000 : null
}
/** Horas desde lo MÁS tardío entre el envío al banco y el cambio al estado actual (misma regla que la base). */
export function horasParaCierre(intento: { cs_request_sent_at: string | null; status_at: string | null }, ahora = Date.now()): number | null {
  const a = horasDesde(intento.cs_request_sent_at, ahora), b = horasDesde(intento.status_at, ahora)
  if (a == null && b == null) return null
  return Math.min(a ?? Infinity, b ?? Infinity)
}
export function buildConsultaCierre(porId: ConsultaCierre['por_id'], h: Hallazgo, operador: string, ahora = new Date()): ConsultaCierre {
  return { consultado_en: ahora.toISOString(), por_id: porId, por_referencia: { realizada: true, transacciones: h.transacciones }, business_center_revisado: true, operador }
}
/** Texto de evidencia que queda en la bitácora: responsable, motivo y hechos del proveedor; sin tokens ni datos de tarjeta. */
export function textoEvidencia(operador: string, motivo: string, h: Hallazgo | null, extra?: string): string {
  const hs = h ? `auth=${h.autorizacion.estado}${h.autorizacion.id ? ':' + h.autorizacion.id : ''} bill=${h.captura.estado}${h.captura.status ? '/' + h.captura.status : ''} reversa=${h.reversa.estado} void=${h.anulacion.estado} tx=${h.transacciones} ref=${h.referencia_coincide ? 'ok' : 'no'} importe=${h.importe_coincide === null ? '?' : h.importe_coincide ? 'ok' : 'NO'}` : 'sin consulta'
  return `[${operador}] ${motivo.replace(/\s+/g, ' ').trim().slice(0, 160)} · proveedor: ${hs}${extra ? ' · ' + extra : ''}`.slice(0, 400)
}

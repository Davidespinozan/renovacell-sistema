// CS-1A.5 · Autorización, captura y contabilización · contratos puros (sin Deno ni red; probados desde vitest).
//
// Contratos oficiales (cliente/muestras oficiales de CyberSource, nombres JSON exactos):
//   POST /pts/v2/payments  { clientReferenceInformation.code, processingInformation { capture: bool, actionList: ['VALIDATE_CONSUMER_AUTHENTICATION'] },
//                            consumerAuthenticationInformation.authenticationTransactionId, orderInformation { amountDetails{totalAmount,currency}, billTo },
//                            tokenInformation.transientTokenJwt }
//     → 201 { id, status: AUTHORIZED | PARTIAL_AUTHORIZED | AUTHORIZED_PENDING_REVIEW | AUTHORIZED_RISK_DECLINED | PENDING_AUTHENTICATION | PENDING_REVIEW |
//             DECLINED | INVALID_REQUEST, reconciliationId, processorInformation { approvalCode, responseCode, transactionId }, errorInformation { reason, message } }
//   POST /pts/v2/payments/{id}/captures { clientReferenceInformation.code, orderInformation.amountDetails{totalAmount,currency} }
//     → 201 { id, status: PENDING | TRANSMITTED, reconciliationId }
// Estrategia de captura (explícita; el modo definitivo se valida en Sandbox con BanBajío):
//   · 'auth_captura' (por defecto, la más conservadora): autorizar (capture:false) y, si AUTHORIZED, capturar aparte. Cada paso deja
//     su propia evidencia; una autorización sin captura NUNCA se contabiliza (queda `authorized`, sin asiento).
//   · 'venta': autorización con capture:true en una sola llamada (sale). AUTHORIZED con capture:true = captura solicitada.
// Un 200/201 NO es prueba de pago: la prueba es `status` + `id` del proveedor, y solo `captured` se contabiliza.

export type ModoCaptura = 'auth_captura' | 'venta'
export const MODO_CAPTURA_POR_DEFECTO: ModoCaptura = 'auth_captura'
export function modoCaptura(valor: string | undefined): ModoCaptura {
  const v = (valor ?? '').trim().toLowerCase()
  return v === 'venta' ? 'venta' : 'auth_captura'
}

export interface BillToPago { firstName: string; lastName: string; address1: string; locality: string; administrativeArea: string; postalCode: string; country: string; email: string; phoneNumber: string }
export interface PaymentRequest {
  clientReferenceInformation: { code: string }
  processingInformation: { capture: boolean; actionList: ['VALIDATE_CONSUMER_AUTHENTICATION'] }
  consumerAuthenticationInformation: { authenticationTransactionId: string }
  orderInformation: { amountDetails: { totalAmount: string; currency: 'MXN' }; billTo: BillToPago }
  tokenInformation: { transientTokenJwt: string }
}
/** El importe viene del INTENTO (fijado en el servidor); el navegador no participa. */
export function buildPaymentRequest(p: { attemptId: string; amount: number; token: string; authenticationTransactionId: string; billTo: BillToPago; modo: ModoCaptura }): PaymentRequest {
  if (!p.token || p.token.split('.').length !== 3) throw new Error('token transitorio inválido')
  if (!Number.isFinite(p.amount) || p.amount <= 0) throw new Error('importe inválido')
  if (!p.authenticationTransactionId) throw new Error('falta authenticationTransactionId')
  return {
    clientReferenceInformation: { code: p.attemptId },
    processingInformation: { capture: p.modo === 'venta', actionList: ['VALIDATE_CONSUMER_AUTHENTICATION'] },
    consumerAuthenticationInformation: { authenticationTransactionId: p.authenticationTransactionId },
    orderInformation: { amountDetails: { totalAmount: p.amount.toFixed(2), currency: 'MXN' }, billTo: p.billTo },
    tokenInformation: { transientTokenJwt: p.token },
  }
}

export interface EvidenciaPago { id: string | null; status: string | null; reconciliationId: string | null; approvalCode: string | null; responseCode: string | null; reason: string | null; message: string | null; eci: string | null }
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null)
export function evidenciaPago(data: unknown): EvidenciaPago {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const pi = (d.processorInformation && typeof d.processorInformation === 'object' ? d.processorInformation : {}) as Record<string, unknown>
  const ei = (d.errorInformation && typeof d.errorInformation === 'object' ? d.errorInformation : {}) as Record<string, unknown>
  const ca = (d.consumerAuthenticationInformation && typeof d.consumerAuthenticationInformation === 'object' ? d.consumerAuthenticationInformation : {}) as Record<string, unknown>
  return { id: s(d.id), status: s(d.status), reconciliationId: s(d.reconciliationId), approvalCode: s(pi.approvalCode), responseCode: s(pi.responseCode), reason: s(ei.reason), message: s(ei.message), eci: s(ca.eci) ?? s(ca.eciRaw) }
}

/** Qué significa la respuesta del banco para el intento. Solo AUTHORIZED con id es dinero aprobado. */
export type ResultadoPago =
  | { resultado: 'autorizada'; evidencia: EvidenciaPago }          // AUTHORIZED
  | { resultado: 'rechazada'; evidencia: EvidenciaPago; motivo: string }   // DECLINED, AUTHORIZED_RISK_DECLINED, INVALID_REQUEST (sin cargo)
  | { resultado: 'incierta'; evidencia: EvidenciaPago; motivo: string }    // PARTIAL_AUTHORIZED, *_PENDING_REVIEW, PENDING_*: pudo haber retención → conciliar
  | { resultado: 'forma_no_reconocida'; evidencia: EvidenciaPago; motivo: string }
export function leerPago(data: unknown): ResultadoPago {
  const ev = evidenciaPago(data)
  switch (ev.status) {
    case 'AUTHORIZED': return ev.id ? { resultado: 'autorizada', evidencia: ev } : { resultado: 'incierta', evidencia: ev, motivo: 'AUTHORIZED sin id de pago' }
    case 'DECLINED': case 'AUTHORIZED_RISK_DECLINED': case 'INVALID_REQUEST':
      return { resultado: 'rechazada', evidencia: ev, motivo: [ev.status, ev.reason, ev.message].filter(Boolean).join(' · ') }
    case 'PARTIAL_AUTHORIZED': case 'AUTHORIZED_PENDING_REVIEW': case 'PENDING_REVIEW': case 'PENDING_AUTHENTICATION':
      return { resultado: 'incierta', evidencia: ev, motivo: `${ev.status}: requiere conciliación antes de cualquier otro cargo` }
    default: return { resultado: 'forma_no_reconocida', evidencia: ev, motivo: `status=${ev.status ?? 'ninguno'}` }
  }
}

export interface CaptureRequest { clientReferenceInformation: { code: string }; orderInformation: { amountDetails: { totalAmount: string; currency: 'MXN' } } }
export function buildCaptureRequest(attemptId: string, amount: number): CaptureRequest {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('importe inválido')
  return { clientReferenceInformation: { code: attemptId }, orderInformation: { amountDetails: { totalAmount: amount.toFixed(2), currency: 'MXN' } } }
}
export type ResultadoCaptura = { resultado: 'capturada'; id: string; status: string; reconciliationId: string | null } | { resultado: 'forma_no_reconocida'; motivo: string }
/** PENDING (y TRANSMITTED) = captura aceptada por CyberSource para liquidación: es la evidencia que permite contabilizar. */
export function leerCaptura(data: unknown): ResultadoCaptura {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const id = s(d.id), status = s(d.status)
  if (id && (status === 'PENDING' || status === 'TRANSMITTED')) return { resultado: 'capturada', id, status, reconciliationId: s(d.reconciliationId) }
  return { resultado: 'forma_no_reconocida', motivo: `status=${status ?? 'ninguno'}${id ? '' : ' sin id'}` }
}

/** Datos que se persisten en el intento (columnas de CS-1A.1a). Sin token, sin PAN. */
export function datosAutorizacion(ev: EvidenciaPago, capturaEnLaMisma: boolean): Record<string, unknown> {
  return { cs_payment_id: ev.id ?? undefined, cs_payment_status: capturaEnLaMisma ? `${ev.status}+CAPTURE` : ev.status ?? undefined, cs_reconciliation_id: ev.reconciliationId ?? undefined,
           cs_approval_code: ev.approvalCode ?? undefined, cs_reason: ev.responseCode ?? undefined, cs_eci: ev.eci ?? undefined }
}
export function datosCaptura(c: { id: string; status: string; reconciliationId: string | null }): Record<string, unknown> {
  return { cs_payment_status: `CAPTURE_${c.status}`, cs_reconciliation_id: c.reconciliationId ?? undefined, cs_reason: `capture:${c.id}` }
}

/** Mensajes que ve el doctor por estado final del intento. Nunca "pago exitoso" sin `posted`. */
export const MENSAJES_ESTADO: Record<string, string> = {
  posted: 'Pago confirmado y registrado.',
  captured: 'Pago capturado por el banco; estamos registrándolo. Si no ves el cambio en unos minutos, contáctanos.',
  authorized: 'Tu banco autorizó el pago, pero la captura quedó pendiente de confirmación. No se realizará otro cargo.',
  declined: 'Tu banco rechazó el pago. Puedes intentar con otra tarjeta.',
  unknown_requires_reconciliation: 'Pago pendiente de verificación con el banco. No vuelvas a intentar: te avisamos en cuanto se resuelva.',
  amount_changed: 'El importe del pedido cambió. Revisa el nuevo saldo antes de pagar.',
}
/** Estados desde los que `pagar` tiene sentido (los demás devuelven el estado actual sin tocar al banco). */
export const ESTADO_PAGABLE = 'auth_validated'
export const ESTADOS_EN_CURSO: readonly string[] = ['authz_sent', 'authorized', 'captured', 'unknown_requires_reconciliation', 'posted']

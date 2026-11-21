// CS-1A.5 · Autorización, captura y contabilización · contratos puros (sin Deno ni red; probados desde vitest).
// CS-BB (21 nov 2026) · alineado al MANUAL DE INTEGRACIÓN de BanBajío §11–13 (venta = autorización + captura con valores 3DS).
//
// Contrato (manual §11.2/§12.2/§13.2; nombres JSON exactos):
//   POST /pts/v2/payments {
//     clientReferenceInformation.code            = id del intento (el MISMO en setup, enroll, validate y pago)
//     processingInformation { capture: true (venta), commerceIndicator }   ← ecommerceIndicator devuelto por 3DS; si falta, por marca
//     orderInformation { amountDetails{totalAmount,currency}, billTo{firstName,lastName,address1,locality,administrativeArea,postalCode,country,email,phoneNumber} }
//     consumerAuthenticationInformation:
//        Visa/Amex   { authenticationTransactionId, cavv, eciRaw, xid, directoryServerTransactionId, paresStatus, strongAuthentication.transactionMode }
//        Mastercard  { eciRaw, ucafCollectionIndicator, ucafAuthenticationData, directoryServerTransactionId, paSpecificationVersion, strongAuthentication.transactionMode }
//        Carnet      conjunto general del §11.2 (authenticationTransactionId, cavv, eciRaw, paresStatus, xid, directoryServerTransactionId) — PENDIENTE confirmar con BanBajío
//     tokenInformation.jti }
//   Ya NO se usa actionList VALIDATE_CONSUMER_AUTHENTICATION ni transientTokenJwt: la autenticación se hizo en pasos separados y sus
//   valores viajan explícitos (manual §10.3: "se deben agregar los valores requeridos del payload de validación a la autorización").
//     → 201 { id, status: AUTHORIZED | … | DECLINED | INVALID_REQUEST, reconciliationId, processorInformation { approvalCode, responseCode, transactionId }, errorInformation }
//   POST /pts/v2/payments/{id}/captures (solo en modo 'auth_captura', que ya no es el de omisión).
// RUTA de transactionMode: el manual escribe "consumerAuthentication.strongAuthentication.transactionMode"; se manda en
// consumerAuthenticationInformation.strongAuthentication.transactionMode. Si BanBajío indica que va directo en
// consumerAuthenticationInformation.transactionMode, se cambia con CS_TRANSACTION_MODE_RUTA=directo (sin tocar código).
// Un 200/201 NO es prueba de pago: la prueba es `status` + `id` del proveedor, y solo `captured` se contabiliza.

export type ModoCaptura = 'auth_captura' | 'venta'
/** Manual §11–13: venta (autorización + captura en una llamada, capture:true). 'auth_captura' solo si se configura explícito. */
export const MODO_CAPTURA_POR_DEFECTO: ModoCaptura = 'venta'
export function modoCaptura(valor: string | undefined): ModoCaptura {
  const v = (valor ?? '').trim().toLowerCase()
  return v === 'auth_captura' ? 'auth_captura' : 'venta'
}
export type RutaTransactionMode = 'strongAuthentication' | 'directo'
export function rutaTransactionMode(valor: string | undefined): RutaTransactionMode {
  return (valor ?? '').trim().toLowerCase() === 'directo' ? 'directo' : 'strongAuthentication'
}

export type Marca = 'visa' | 'mastercard' | 'amex' | 'carnet'
const MARCAS: Record<string, Marca> = { '001': 'visa', VISA: 'visa', visa: 'visa', '002': 'mastercard', MASTERCARD: 'mastercard', mastercard: 'mastercard', MC: 'mastercard', '003': 'amex', AMEX: 'amex', amex: 'amex', AMERICAN_EXPRESS: 'amex', '058': 'carnet', CARNET: 'carnet', carnet: 'carnet' }
export function normalizarMarca(v: unknown): Marca | null { return MARCAS[String(v ?? '').trim()] ?? MARCAS[String(v ?? '').trim().toUpperCase()] ?? null }

/** Respaldo del manual cuando 3DS no devuelve ecommerceIndicator. Carnet: sin valor supuesto (configurable; falla cerrado). */
export const INDICADOR_POR_MARCA: Record<Exclude<Marca, 'carnet'>, string> = { visa: 'vbv', mastercard: 'spa', amex: 'aesk' }
export function indicadorComercio(p: { devuelto: string | null; marca: Marca | null; carnetEnv?: string | null }): { ok: true; valor: string } | { ok: false; motivo: 'sin_indicador_carnet' | 'marca_desconocida' } {
  const dev = (p.devuelto ?? '').trim()
  if (dev) return { ok: true, valor: dev }
  if (p.marca === 'carnet') {
    const c = (p.carnetEnv ?? '').trim()
    return c && /^[a-z0-9_]{2,20}$/i.test(c) ? { ok: true, valor: c } : { ok: false, motivo: 'sin_indicador_carnet' }
  }
  if (!p.marca) return { ok: false, motivo: 'marca_desconocida' }
  return { ok: true, valor: INDICADOR_POR_MARCA[p.marca] }
}

/** Valores 3DS guardados por cs-3ds (fila de card_payment_3ds_auth). */
export interface Datos3dsPago {
  jti: string; token_exp: string; card_brand: string | null; authentication_transaction_id: string | null; pares_status: string | null
  eci: string | null; eci_raw: string | null; cavv: string | null; xid: string | null; ucaf_collection_indicator: string | null; ucaf_authentication_data: string | null
  directory_server_transaction_id: string | null; specification_version: string | null; ecommerce_indicator: string | null
}
export const COLUMNAS_3DS_PAGO = 'jti, token_exp, card_brand, authentication_transaction_id, pares_status, eci, eci_raw, cavv, xid, ucaf_collection_indicator, ucaf_authentication_data, directory_server_transaction_id, specification_version, ecommerce_indicator'

export interface BillToPago { firstName: string; lastName: string; address1: string; locality: string; administrativeArea: string; postalCode: string; country: string; email: string; phoneNumber: string }
export interface PaymentRequest {
  clientReferenceInformation: { code: string }
  processingInformation: { capture: boolean; commerceIndicator: string }
  orderInformation: { amountDetails: { totalAmount: string; currency: 'MXN' }; billTo: BillToPago }
  consumerAuthenticationInformation: Record<string, unknown>
  tokenInformation: { jti: string }
}
const quitarVacios = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''))

/** Campos 3DS de la autorización por marca (manual §12 Visa/Amex, §13 Mastercard, §11.2 general para Carnet). */
export function consumerAuthPago(a: Datos3dsPago, marca: Marca, ruta: RutaTransactionMode = 'strongAuthentication'): Record<string, unknown> {
  const eciRaw = a.eci_raw ?? a.eci
  const base = marca === 'mastercard'
    ? { eciRaw, ucafCollectionIndicator: a.ucaf_collection_indicator, ucafAuthenticationData: a.ucaf_authentication_data,
        directoryServerTransactionId: a.directory_server_transaction_id, paSpecificationVersion: a.specification_version }
    : { authenticationTransactionId: a.authentication_transaction_id, cavv: a.cavv, eciRaw, xid: a.xid,
        directoryServerTransactionId: a.directory_server_transaction_id, paresStatus: a.pares_status }
  const modo = ruta === 'directo' ? { transactionMode: 'S' } : { strongAuthentication: { transactionMode: 'S' } }
  return { ...quitarVacios(base), ...modo }
}

/** El importe viene del INTENTO (fijado en el servidor); el navegador no participa. */
export function buildPaymentRequest(p: { attemptId: string; amount: number; jti: string; auth: Datos3dsPago; marca: Marca; commerceIndicator: string; billTo: BillToPago; modo: ModoCaptura; rutaModo?: RutaTransactionMode }): PaymentRequest {
  if (!p.jti || !/^[A-Za-z0-9_-]{1,128}$/.test(p.jti)) throw new Error('jti inválido')
  if (!Number.isFinite(p.amount) || p.amount <= 0) throw new Error('importe inválido')
  if (!p.commerceIndicator) throw new Error('falta commerceIndicator')
  if (p.marca !== 'mastercard' && !p.auth.authentication_transaction_id) throw new Error('falta authenticationTransactionId')
  return {
    clientReferenceInformation: { code: p.attemptId },
    processingInformation: { capture: p.modo === 'venta', commerceIndicator: p.commerceIndicator },
    orderInformation: { amountDetails: { totalAmount: p.amount.toFixed(2), currency: 'MXN' }, billTo: p.billTo },
    consumerAuthenticationInformation: consumerAuthPago(p.auth, p.marca, p.rutaModo),
    tokenInformation: { jti: p.jti },
  }
}

export interface EvidenciaPago { id: string | null; status: string | null; reconciliationId: string | null; approvalCode: string | null; responseCode: string | null; reason: string | null; message: string | null; eci: string | null; processorTransactionId: string | null }
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null)
export function evidenciaPago(data: unknown): EvidenciaPago {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const pi = (d.processorInformation && typeof d.processorInformation === 'object' ? d.processorInformation : {}) as Record<string, unknown>
  const ei = (d.errorInformation && typeof d.errorInformation === 'object' ? d.errorInformation : {}) as Record<string, unknown>
  const ca = (d.consumerAuthenticationInformation && typeof d.consumerAuthenticationInformation === 'object' ? d.consumerAuthenticationInformation : {}) as Record<string, unknown>
  return { id: s(d.id), status: s(d.status), reconciliationId: s(d.reconciliationId), approvalCode: s(pi.approvalCode), responseCode: s(pi.responseCode), reason: s(ei.reason), message: s(ei.message), eci: s(ca.eci) ?? s(ca.eciRaw), processorTransactionId: s(pi.transactionId) }
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

/**
 * Mensaje para el DOCTOR ante un rechazo o error del banco. Nunca el texto técnico de CyberSource (ese solo va a los logs y a la
 * bitácora de eventos del intento). Por motivo (errorInformation.reason) cuando ayuda al doctor a corregir; si no, genérico.
 */
export const MENSAJES_RECHAZO_CLIENTE: Record<string, string> = {
  INSUFFICIENT_FUND: 'Tu banco rechazó el pago por fondos o límite insuficiente. Puedes intentar con otra tarjeta.',
  EXPIRED_CARD: 'La tarjeta está vencida. Intenta con otra tarjeta.',
  INVALID_CVN: 'El código de seguridad (CVV) no es correcto. Vuelve a capturar tu tarjeta.',
  CV_FAILED: 'El código de seguridad (CVV) no es correcto. Vuelve a capturar tu tarjeta.',
  INVALID_ACCOUNT: 'Los datos de la tarjeta no son válidos. Revisa el número o intenta con otra tarjeta.',
  INVALID_CARD: 'Los datos de la tarjeta no son válidos. Revisa el número o intenta con otra tarjeta.',
  CARD_TYPE_NOT_ACCEPTED: 'Este tipo de tarjeta no se acepta. Intenta con otra tarjeta.',
  CONSUMER_AUTHENTICATION_FAILED: 'Tu banco no pudo autenticar esta tarjeta. Por favor usa otra tarjeta u otra forma de pago.',
  CONSUMER_AUTHENTICATION_REQUIRED: 'Tu banco pidió una verificación adicional que no se completó. Vuelve a capturar tu tarjeta.',
  DUPLICATE_REQUEST: 'Este pago ya se había enviado. Consulta el estado de tu pedido antes de intentar de nuevo.',
}
export const MENSAJE_RECHAZO_GENERICO = 'Tu banco rechazó el pago. Puedes intentar con otra tarjeta u otra forma de pago; no se realizó ningún cargo.'
export function mensajeRechazoCliente(reason: string | null | undefined): string {
  const r = String(reason ?? '').trim().toUpperCase()
  return MENSAJES_RECHAZO_CLIENTE[r] ?? MENSAJE_RECHAZO_GENERICO
}
/** reason del cuerpo de un error HTTP de CyberSource ({status, reason, message}). */
export function reasonDeError(data: unknown): string | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const ei = (d.errorInformation && typeof d.errorInformation === 'object' ? d.errorInformation : {}) as Record<string, unknown>
  const r = typeof d.reason === 'string' ? d.reason : typeof ei.reason === 'string' ? ei.reason : null
  return r ? r.slice(0, 60) : null
}

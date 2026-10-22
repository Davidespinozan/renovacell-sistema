// CS-1A.4 · Payer Authentication (3DS 2.x) · contratos puros (sin Deno ni red; probados desde vitest).
//
// Contratos oficiales (cliente/muestras oficiales de CyberSource, nombres JSON exactos):
//   1) POST /risk/v1/authentication-setups   { clientReferenceInformation.code, tokenInformation.transientToken }
//      → status COMPLETED | FAILED; consumerAuthenticationInformation { accessToken, deviceDataCollectionUrl, referenceId }
//   2) Device Data Collection: iframe oculto 10×10 con form POST a deviceDataCollectionUrl (input JWT = accessToken); postMessage
//      desde https://centinelapistag.cardinalcommerce.com (test) / https://centinelapi.cardinalcommerce.com (prod) con
//      { MessageType: 'profile.completed', SessionId, Status }; puede tardar hasta 10 s.
//   3) POST /risk/v1/authentications  { clientReferenceInformation.code, orderInformation{amountDetails{currency,totalAmount}, billTo{…}},
//      tokenInformation.transientToken, consumerAuthenticationInformation{referenceId, returnUrl, transactionMode, deviceChannel},
//      deviceInformation{11 campos del navegador} }
//      → status AUTHENTICATION_SUCCESSFUL | PENDING_AUTHENTICATION | AUTHENTICATION_FAILED;
//        consumerAuthenticationInformation { authenticationTransactionId, stepUpUrl, accessToken, pareq, challengeRequired, veresEnrolled,
//        eci, eciRaw, paresStatus, specificationVersion, effectiveAuthenticationType, directoryServerTransactionId, xid, cavv }
//   4) Step-up: iframe con form POST a stepUpUrl (JWT = accessToken, MD opcional); al terminar, el ACS redirige al returnUrl con TransactionId.
//   5) POST /risk/v1/authentication-results { clientReferenceInformation.code, consumerAuthenticationInformation.authenticationTransactionId,
//      orderInformation.amountDetails } → status AUTHENTICATION_SUCCESSFUL | AUTHENTICATION_FAILED (+ PENDING si el reto no terminó)
//      NOTA: el modelo oficial de validate solo acepta tokenInformation.jti (TMS), no el JWT de Flex; se valida por transactionId.
// Nada aquí toca /pts/v2/payments. Un 200/201 no es un pago. La evidencia que se persiste es la mínima para autorizar después:
// referenceId, authenticationTransactionId, status y eci en el intento; el resto en la bitácora de eventos (sin PAN, sin tokens).

export const ORIGENES_DDC: Record<'test' | 'production', string> = { test: 'https://centinelapistag.cardinalcommerce.com', production: 'https://centinelapi.cardinalcommerce.com' }
export const HOST_CARDINAL = /(^|\.)cardinalcommerce\.com$/i
export const RUTA_RETORNO_3DS = '/functions/v1/cs-3ds-return'

export function urlEsCardinal(u: string): boolean {
  try { const x = new URL(u); return x.protocol === 'https:' && HOST_CARDINAL.test(x.hostname) } catch { return false }
}

export interface SetupRequest { clientReferenceInformation: { code: string }; tokenInformation: { transientToken: string } }
export function buildSetupRequest(attemptId: string, token: string): SetupRequest {
  if (!token || token.split('.').length !== 3) throw new Error('token transitorio inválido')
  return { clientReferenceInformation: { code: attemptId }, tokenInformation: { transientToken: token } }
}
export type LecturaSetup = { ok: true; referenceId: string; accessToken: string; ddcUrl: string } | { ok: false; motivo: 'fallido' | 'incompleto' | 'url_no_cardinal'; detalle: string }
export function leerSetup(data: unknown): LecturaSetup {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const c = (d.consumerAuthenticationInformation && typeof d.consumerAuthenticationInformation === 'object' ? d.consumerAuthenticationInformation : {}) as Record<string, unknown>
  if (d.status !== 'COMPLETED') return { ok: false, motivo: 'fallido', detalle: String(d.status ?? 'sin status') }
  const referenceId = String(c.referenceId ?? ''), accessToken = String(c.accessToken ?? ''), ddcUrl = String(c.deviceDataCollectionUrl ?? '')
  if (!referenceId || !accessToken || !ddcUrl) return { ok: false, motivo: 'incompleto', detalle: 'faltan referenceId/accessToken/deviceDataCollectionUrl' }
  if (!urlEsCardinal(ddcUrl)) return { ok: false, motivo: 'url_no_cardinal', detalle: 'deviceDataCollectionUrl fuera de cardinalcommerce.com' }
  return { ok: true, referenceId, accessToken, ddcUrl }
}

/** 11 campos del navegador exigidos en el enrolamiento (respaldo si la recolección de dispositivo falla). Ninguno es sensible. */
export interface DispositivoNavegador {
  httpBrowserLanguage: string; httpBrowserJavaEnabled: boolean; httpBrowserJavaScriptEnabled: boolean
  httpBrowserColorDepth: string; httpBrowserScreenHeight: string; httpBrowserScreenWidth: string; httpBrowserTimeDifference: string
}
export interface DispositivoCompleto extends DispositivoNavegador { ipAddress?: string; httpAcceptBrowserValue: string; httpAcceptContent: string; userAgentBrowserValue: string }
const num = (v: unknown, max: number) => { const s = String(v ?? '').replace(/\D/g, '').slice(0, 6); return s && Number(s) <= max ? s : '' }
export function normalizarDispositivo(d: unknown, cab: { accept?: string | null; userAgent?: string | null; ip?: string | null }): DispositivoCompleto | null {
  const x = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
  const lang = String(x.httpBrowserLanguage ?? '').slice(0, 16)
  const dev: DispositivoCompleto = {
    httpBrowserLanguage: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang) ? lang : 'es-MX',
    httpBrowserJavaEnabled: x.httpBrowserJavaEnabled === true,
    httpBrowserJavaScriptEnabled: true,
    httpBrowserColorDepth: num(x.httpBrowserColorDepth, 48) || '24',
    httpBrowserScreenHeight: num(x.httpBrowserScreenHeight, 20000),
    httpBrowserScreenWidth: num(x.httpBrowserScreenWidth, 20000),
    httpBrowserTimeDifference: String(x.httpBrowserTimeDifference ?? '').replace(/[^-\d]/g, '').slice(0, 5) || '0',
    httpAcceptBrowserValue: (cab.accept ?? '*/*').slice(0, 255),
    httpAcceptContent: (cab.accept ?? '*/*').slice(0, 255),
    userAgentBrowserValue: (cab.userAgent ?? '').slice(0, 255),
  }
  if (!dev.httpBrowserScreenHeight || !dev.httpBrowserScreenWidth || !dev.userAgentBrowserValue) return null
  const ip = (cab.ip ?? '').split(',')[0].trim()
  if (/^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i.test(ip)) dev.ipAddress = ip
  return dev
}

export interface BillTo { firstName: string; lastName: string; address1: string; locality: string; administrativeArea: string; postalCode: string; country: string; email: string; phoneNumber: string }
const limpia = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')   // CyberSource via VisaNet no procesa no-ASCII
export function partirNombre(completo: string): { firstName: string; lastName: string } {
  const p = limpia(completo, 120).split(' ').filter(Boolean)
  if (p.length === 0) return { firstName: '', lastName: '' }
  if (p.length === 1) return { firstName: p[0], lastName: p[0] }
  const corte = p.length >= 4 ? 2 : 1
  return { firstName: p.slice(0, corte).join(' '), lastName: p.slice(corte).join(' ') }
}
/** Arma el bill-to con lo que el ERP ya sabe (domicilio del pedido, cliente, perfil). Devuelve qué falta si no alcanza. */
export function buildBillTo(src: { nombre?: string; email?: string; phone?: string; address?: Record<string, unknown> | null }): { ok: true; billTo: BillTo } | { ok: false; faltan: string[] } {
  const a = (src.address ?? {}) as Record<string, unknown>
  const { firstName, lastName } = partirNombre(sinAcentos(limpia(src.nombre, 120)))
  const billTo: BillTo = {
    firstName: firstName.slice(0, 60), lastName: lastName.slice(0, 60),
    address1: sinAcentos(limpia(a.line1, 60)), locality: sinAcentos(limpia(a.city, 50)), administrativeArea: sinAcentos(limpia(a.state, 50)),
    postalCode: limpia(a.cp, 9).replace(/\D/g, ''), country: 'MX',
    email: limpia(src.email, 255).toLowerCase(), phoneNumber: limpia(src.phone ?? a.phone, 15).replace(/\D/g, ''),
  }
  const faltan = (Object.keys(billTo) as Array<keyof BillTo>).filter((k) => !billTo[k])
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(billTo.email)) faltan.push('email')
  if (billTo.postalCode.length !== 5) faltan.push('postalCode')
  if (billTo.phoneNumber.length < 10) faltan.push('phoneNumber')
  const u = [...new Set(faltan)]
  return u.length ? { ok: false, faltan: u } : { ok: true, billTo }
}

export interface EnrollRequest {
  clientReferenceInformation: { code: string }
  orderInformation: { amountDetails: { currency: 'MXN'; totalAmount: string }; billTo: BillTo }
  tokenInformation: { transientToken: string }
  consumerAuthenticationInformation: { referenceId: string; returnUrl: string; transactionMode: 'S'; deviceChannel: 'Browser' }
  deviceInformation: DispositivoCompleto
}
export function buildEnrollRequest(p: { attemptId: string; token: string; amount: number; billTo: BillTo; referenceId: string; returnUrl: string; dispositivo: DispositivoCompleto }): EnrollRequest {
  if (!p.token || p.token.split('.').length !== 3) throw new Error('token transitorio inválido')
  if (!Number.isFinite(p.amount) || p.amount <= 0) throw new Error('importe inválido')
  if (!p.referenceId) throw new Error('falta referenceId')
  return {
    clientReferenceInformation: { code: p.attemptId },
    orderInformation: { amountDetails: { currency: 'MXN', totalAmount: p.amount.toFixed(2) }, billTo: p.billTo },
    tokenInformation: { transientToken: p.token },
    consumerAuthenticationInformation: { referenceId: p.referenceId, returnUrl: p.returnUrl, transactionMode: 'S', deviceChannel: 'Browser' },
    deviceInformation: p.dispositivo,
  }
}

export interface EvidenciaAuth { authenticationTransactionId: string | null; eci: string | null; eciRaw: string | null; paresStatus: string | null; veresEnrolled: string | null; specificationVersion: string | null; effectiveAuthenticationType: string | null; challengeRequired: string | null; directoryServerTransactionId: string | null; cardholderMessage: string | null }
export type LecturaEnroll =
  | { ok: true; resultado: 'autenticada'; evidencia: EvidenciaAuth }
  | { ok: true; resultado: 'reto'; evidencia: EvidenciaAuth; stepUpUrl: string; accessToken: string; ventana: '01' | '02' | '03' | '04' | '05' }
  | { ok: true; resultado: 'rechazada'; evidencia: EvidenciaAuth; motivo: string }
  | { ok: false; motivo: 'forma_no_reconocida' | 'reto_incompleto' | 'url_no_cardinal'; detalle: string }
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null)
export function evidenciaDe(c: Record<string, unknown>): EvidenciaAuth {
  return { authenticationTransactionId: s(c.authenticationTransactionId), eci: s(c.eci), eciRaw: s(c.eciRaw), paresStatus: s(c.paresStatus), veresEnrolled: s(c.veresEnrolled),
           specificationVersion: s(c.specificationVersion), effectiveAuthenticationType: s(c.effectiveAuthenticationType), challengeRequired: s(c.challengeRequired),
           directoryServerTransactionId: s(c.directoryServerTransactionId), cardholderMessage: s(c.cardholderMessage) }
}
/** Tamaño de ventana del reto (EMVCo challengeWindowSize) leído del pareq; 02 (390×400) si no se puede leer. */
export function ventanaDesdePareq(pareq: unknown): '01' | '02' | '03' | '04' | '05' {
  try {
    const b = String(pareq ?? '').replace(/-/g, '+').replace(/_/g, '/')
    const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (ch) => ch.charCodeAt(0)))) as Record<string, unknown>
    const w = String(j.challengeWindowSize ?? '')
    return (['01', '02', '03', '04', '05'] as const).includes(w as '01') ? (w as '01') : '02'
  } catch { return '02' }
}
export const VENTANAS_RETO: Record<'01' | '02' | '03' | '04' | '05', { w: number; h: number } | null> = { '01': { w: 250, h: 400 }, '02': { w: 390, h: 400 }, '03': { w: 500, h: 600 }, '04': { w: 600, h: 400 }, '05': null }

export function leerEnroll(data: unknown): LecturaEnroll {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const c = (d.consumerAuthenticationInformation && typeof d.consumerAuthenticationInformation === 'object' ? d.consumerAuthenticationInformation : {}) as Record<string, unknown>
  const ev = evidenciaDe(c)
  switch (d.status) {
    case 'AUTHENTICATION_SUCCESSFUL': return { ok: true, resultado: 'autenticada', evidencia: ev }
    case 'PENDING_AUTHENTICATION': {
      const stepUpUrl = String(c.stepUpUrl ?? ''), accessToken = String(c.accessToken ?? '')
      if (!stepUpUrl || !accessToken || !ev.authenticationTransactionId) return { ok: false, motivo: 'reto_incompleto', detalle: 'faltan stepUpUrl/accessToken/authenticationTransactionId' }
      if (!urlEsCardinal(stepUpUrl)) return { ok: false, motivo: 'url_no_cardinal', detalle: 'stepUpUrl fuera de cardinalcommerce.com' }
      return { ok: true, resultado: 'reto', evidencia: ev, stepUpUrl, accessToken, ventana: ventanaDesdePareq(c.pareq) }
    }
    case 'AUTHENTICATION_FAILED': return { ok: true, resultado: 'rechazada', evidencia: ev, motivo: s(d.message) ?? s((d.errorInformation as Record<string, unknown> | undefined)?.reason) ?? 'AUTHENTICATION_FAILED' }
    default: return { ok: false, motivo: 'forma_no_reconocida', detalle: `status=${String(d.status ?? 'ninguno')}` }
  }
}

export interface ValidateRequest { clientReferenceInformation: { code: string }; consumerAuthenticationInformation: { authenticationTransactionId: string }; orderInformation: { amountDetails: { currency: 'MXN'; totalAmount: string } } }
export function buildValidateRequest(attemptId: string, authenticationTransactionId: string, amount: number): ValidateRequest {
  if (!authenticationTransactionId) throw new Error('falta authenticationTransactionId')
  return { clientReferenceInformation: { code: attemptId }, consumerAuthenticationInformation: { authenticationTransactionId }, orderInformation: { amountDetails: { currency: 'MXN', totalAmount: amount.toFixed(2) } } }
}
export type LecturaValidate = { ok: true; resultado: 'autenticada' | 'rechazada' | 'pendiente'; evidencia: EvidenciaAuth; motivo?: string } | { ok: false; motivo: 'forma_no_reconocida'; detalle: string }
export function leerValidate(data: unknown): LecturaValidate {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const c = (d.consumerAuthenticationInformation && typeof d.consumerAuthenticationInformation === 'object' ? d.consumerAuthenticationInformation : {}) as Record<string, unknown>
  const ev = evidenciaDe(c)
  switch (d.status) {
    case 'AUTHENTICATION_SUCCESSFUL': return { ok: true, resultado: 'autenticada', evidencia: ev }
    case 'AUTHENTICATION_FAILED': return { ok: true, resultado: 'rechazada', evidencia: ev, motivo: s(d.message) ?? 'AUTHENTICATION_FAILED' }
    case 'PENDING_AUTHENTICATION': return { ok: true, resultado: 'pendiente', evidencia: ev }
    default: return { ok: false, motivo: 'forma_no_reconocida', detalle: `status=${String(d.status ?? 'ninguno')}` }
  }
}

/** Lo que persistimos del resultado 3DS en el intento (columnas de CS-1A.1a) y en la bitácora (detalle). Sin cavv, xid ni tokens. */
export function datosAvance(ev: EvidenciaAuth, status: string): Record<string, unknown> {
  return { cs_auth_transaction_id: ev.authenticationTransactionId ?? undefined, cs_auth_status: status, cs_eci: ev.eci ?? ev.eciRaw ?? undefined,
           evidencia: undefined,
           detalle_3ds: { paresStatus: ev.paresStatus, veresEnrolled: ev.veresEnrolled, specificationVersion: ev.specificationVersion, effectiveAuthenticationType: ev.effectiveAuthenticationType, challengeRequired: ev.challengeRequired, directoryServerTransactionId: ev.directoryServerTransactionId } }
}

/** Estados del intento en los que cada acción es válida (la máquina real vive en cs_intento_avanzar; esto solo evita llamadas inútiles al proveedor). */
export const ESTADOS_ACCION: Record<'setup' | 'enroll' | 'validate' | 'abandonar', readonly string[]> = {
  setup: ['created', 'tokenized'],
  enroll: ['auth_setup'],
  validate: ['auth_challenge'],
  abandonar: ['created', 'tokenized', 'auth_setup', 'auth_pending', 'auth_challenge'],
}

/** Página mínima que devuelve el returnUrl del reto: avisa al padre y nada más (el navegador no decide nada). */
export function htmlRetorno3ds(): string {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Verificación</title></head><body style="font-family:system-ui;font-size:14px;color:#1b1f1d;padding:16px">' +
         'Verificación completada. Regresando…' +
         '<script>try{window.parent.postMessage({tipo:"renovacell-3ds-return"},"*")}catch(e){}</script></body></html>'
}

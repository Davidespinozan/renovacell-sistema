// CS-1A.4 · Payer Authentication (3DS 2.x) · contratos puros (sin Deno ni red; probados desde vitest).
// CS-BB (21 nov 2026) · alineado al MANUAL DE INTEGRACIÓN de BanBajío (Microform Flex v2 + Payer Authentication + Payment Gateway).
//
// Contratos (manual BanBajío; nombres JSON exactos):
//   1) POST /risk/v1/authentication-setups   { clientReferenceInformation.code, tokenInformation.jti }            (§7.2)
//      → status COMPLETED | FAILED; consumerAuthenticationInformation { accessToken, deviceDataCollectionUrl, referenceId }
//   2) Device Data Collection: iframe oculto 10×10 con form POST a deviceDataCollectionUrl (input JWT = accessToken); postMessage
//      desde https://centinelapistag.cardinalcommerce.com (test) / https://centinelapi.cardinalcommerce.com (prod) con
//      { MessageType: 'profile.completed', SessionId, Status }; puede tardar hasta 10 s.                         (§7.4)
//   3) POST /risk/v1/authentications  { clientReferenceInformation.code, orderInformation{amountDetails, billTo}, tokenInformation.jti,
//      buyerInformation.mobilePhone, deviceInformation{campos del navegador KA-04583},
//      consumerAuthenticationInformation{deviceChannel:'BROWSER', returnUrl, referenceId, transactionMode:'S'} }   (§8)
//      → consumerAuthenticationInformation { paresStatus, authenticationTransactionId, stepUpUrl, accessToken, pareq, eci, eciRaw,
//        cavv, xid, ucafAuthenticationData, ucafCollectionIndicator, directoryServerTransactionId, specificationVersion,
//        ecommerceIndicator } + paymentInformation.card.type
//   4) Step-up: iframe con form POST a stepUpUrl (JWT = accessToken, MD opcional); al terminar, el ACS hace POST al returnUrl
//      (TransactionId, MD) DENTRO del iframe. El returnUrl vive en el DOMINIO DE LA APP (Netlify Edge /pago/3ds-retorno): las
//      Edge Functions de *.supabase.co sirven text/html como text/plain y su script nunca correría.                 (§9)
//   5) POST /risk/v1/authentication-results { clientReferenceInformation.code, consumerAuthenticationInformation.authenticationTransactionId,
//      orderInformation.amountDetails, tokenInformation.jti } — tras un reto, sus valores 3DS REEMPLAZAN a los del enroll. (§10)
// POLÍTICA paresStatus (decisión del dueño): Y y A → se cobra; C → reto; U, N, R y cualquier otro → se rechaza SIN cobrar y se pide
// otra tarjeta (mensaje estilo §10.5). Se decide por paresStatus, no solo por `status`.
// Nada aquí toca /pts/v2/payments. Los valores 3DS (cavv, xid, ucaf…) viajan a cs-pago por la tabla de corta vida
// card_payment_3ds_auth (solo servidor, 1 h); el intento y su bitácora de eventos NO los guardan. Sin PAN, sin CVV, sin tokens.

export const ORIGENES_DDC: Record<'test' | 'production', string> = { test: 'https://centinelapistag.cardinalcommerce.com', production: 'https://centinelapi.cardinalcommerce.com' }
export const HOST_CARDINAL = /(^|\.)cardinalcommerce\.com$/i
/** returnUrl del reto en el dominio de la app (Netlify Edge `pago-3ds-retorno`). */
export const RUTA_RETORNO_3DS = '/pago/3ds-retorno'

export function urlEsCardinal(u: string): boolean {
  try { const x = new URL(u); return x.protocol === 'https:' && HOST_CARDINAL.test(x.hostname) } catch { return false }
}

/**
 * returnUrl del reto = origen de la página del doctor (ya validado contra la lista blanca) + /pago/3ds-retorno. Debe ser el MISMO
 * origen que la página: la página de retorno avisa al padre con postMessage(targetOrigin = su propio origen).
 * CS_RETURN_URL (opcional) fija la URL completa, pero solo se acepta si es https, termina en /pago/3ds-retorno y su origen
 * coincide con el de la página (si no, el aviso nunca llegaría al padre).
 */
export function construirReturnUrl(p: { origen: string; origenPermitido: boolean; envReturnUrl?: string | null }): { ok: true; url: string; origen: string } | { ok: false; motivo: 'origen_no_permitido' | 'retorno_invalido' } {
  if (!p.origenPermitido || !p.origen) return { ok: false, motivo: 'origen_no_permitido' }
  let o: URL
  try { o = new URL(p.origen) } catch { return { ok: false, motivo: 'origen_no_permitido' } }
  if (!(o.protocol === 'https:' || (o.protocol === 'http:' && o.hostname === 'localhost'))) return { ok: false, motivo: 'origen_no_permitido' }
  const env = (p.envReturnUrl ?? '').trim()
  if (env) {
    let u: URL
    try { u = new URL(env) } catch { return { ok: false, motivo: 'retorno_invalido' } }
    if (u.protocol !== 'https:' || u.origin !== o.origin || u.pathname !== RUTA_RETORNO_3DS) return { ok: false, motivo: 'retorno_invalido' }
    return { ok: true, url: u.origin + u.pathname, origen: u.origin }
  }
  return { ok: true, url: o.origin + RUTA_RETORNO_3DS, origen: o.origin }
}

/** Política del dueño sobre paresStatus (manual §8.2/§10.3: solo 2.1 Y, 2.3 A y 2.9 Y tras reto generan firma válida). */
export type DecisionPares = 'cobrar' | 'reto' | 'rechazar'
export function politicaPares(paresStatus: string | null | undefined): DecisionPares {
  const p = String(paresStatus ?? '').trim().toUpperCase()
  if (p === 'Y' || p === 'A') return 'cobrar'
  if (p === 'C') return 'reto'
  return 'rechazar'
}
/** Mensaje al doctor cuando su banco no autentica (manual §10.5, en español). Nunca texto técnico de CyberSource. */
export const MENSAJE_RECHAZO_3DS = 'Tu banco no pudo autenticar esta tarjeta. Por favor usa otra tarjeta u otra forma de pago para completar tu compra. No se realizó ningún cargo.'
/** Mensaje cuando el token transitorio (15 min) caducó: el doctor vuelve a capturar la tarjeta (manual §6.1). */
export const MENSAJE_TARJETA_EXPIRADA = 'Por seguridad, los datos de tu tarjeta caducan a los 15 minutos. Vuelve a capturar tu tarjeta para continuar; no se realizó ningún cargo.'
/** Mensaje cuando el doctor capturó una tarjeta distinta de la autenticada: se exige un 3DS nuevo. */
export const MENSAJE_REAUTENTICAR = 'Capturaste una tarjeta nueva, así que tu banco debe verificarla de nuevo. Vuelve a capturarla para continuar; no se realizó ningún cargo.'

export interface SetupRequest { clientReferenceInformation: { code: string }; tokenInformation: { jti: string } }
/** Manual §7.2: el setup lleva el `jti` del token transitorio (no el JWT completo). El code = id del intento, igual en todas las llamadas. */
export function buildSetupRequest(attemptId: string, jti: string): SetupRequest {
  if (!jti || !/^[A-Za-z0-9_-]{1,128}$/.test(jti)) throw new Error('jti inválido')
  return { clientReferenceInformation: { code: attemptId }, tokenInformation: { jti } }
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
  tokenInformation: { jti: string }
  buyerInformation?: { mobilePhone: number }
  deviceInformation: DispositivoCompleto
  consumerAuthenticationInformation: { deviceChannel: 'BROWSER'; returnUrl: string; referenceId: string; transactionMode: 'S' }
}
/** Teléfono móvil del cliente, solo dígitos (10 en México; se quita el 52 de país si viene con 12). Número, como en el manual §8. */
export function telefonoMovil(v: unknown): number | null {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('52')) d = d.slice(2)
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3)
  if (d.length < 10 || d.length > 15 || d.startsWith('0')) return null
  return Number(d)
}
export function buildEnrollRequest(p: { attemptId: string; jti: string; amount: number; billTo: BillTo; referenceId: string; returnUrl: string; dispositivo: DispositivoCompleto; movil?: unknown }): EnrollRequest {
  if (!p.jti || !/^[A-Za-z0-9_-]{1,128}$/.test(p.jti)) throw new Error('jti inválido')
  if (!Number.isFinite(p.amount) || p.amount <= 0) throw new Error('importe inválido')
  if (!p.referenceId) throw new Error('falta referenceId')
  if (!p.returnUrl) throw new Error('falta returnUrl')
  const movil = telefonoMovil(p.movil) ?? telefonoMovil(p.billTo.phoneNumber)
  return {
    clientReferenceInformation: { code: p.attemptId },
    orderInformation: { amountDetails: { currency: 'MXN', totalAmount: p.amount.toFixed(2) }, billTo: p.billTo },
    tokenInformation: { jti: p.jti },
    ...(movil ? { buyerInformation: { mobilePhone: movil } } : {}),
    deviceInformation: p.dispositivo,
    consumerAuthenticationInformation: { deviceChannel: 'BROWSER', returnUrl: p.returnUrl, referenceId: p.referenceId, transactionMode: 'S' },
  }
}

export interface EvidenciaAuth {
  authenticationTransactionId: string | null; eci: string | null; eciRaw: string | null; paresStatus: string | null; veresEnrolled: string | null
  specificationVersion: string | null; effectiveAuthenticationType: string | null; challengeRequired: string | null; directoryServerTransactionId: string | null
  cardholderMessage: string | null
  /** Valores para la autorización (manual §11–13). Solo viajan a card_payment_3ds_auth (servidor, 1 h). */
  cavv: string | null; xid: string | null; ucafAuthenticationData: string | null; ucafCollectionIndicator: string | null; ecommerceIndicator: string | null; cardType: string | null
}
export type Ventana = '01' | '02' | '03' | '04' | '05'
export type LecturaEnroll =
  | { ok: true; resultado: 'autenticada'; evidencia: EvidenciaAuth }
  | { ok: true; resultado: 'reto'; evidencia: EvidenciaAuth; stepUpUrl: string; accessToken: string; ventana: Ventana }
  | { ok: true; resultado: 'rechazada'; evidencia: EvidenciaAuth; motivo: string }
  | { ok: false; motivo: 'forma_no_reconocida' | 'reto_incompleto' | 'url_no_cardinal'; detalle: string }
const s = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : null)
export function evidenciaDe(c: Record<string, unknown>, d: Record<string, unknown> = {}): EvidenciaAuth {
  const pi = (d.paymentInformation && typeof d.paymentInformation === 'object' ? d.paymentInformation : {}) as Record<string, unknown>
  const card = (pi.card && typeof pi.card === 'object' ? pi.card : {}) as Record<string, unknown>
  return { authenticationTransactionId: s(c.authenticationTransactionId), eci: s(c.eci), eciRaw: s(c.eciRaw), paresStatus: s(c.paresStatus), veresEnrolled: s(c.veresEnrolled),
           specificationVersion: s(c.specificationVersion), effectiveAuthenticationType: s(c.effectiveAuthenticationType), challengeRequired: s(c.challengeRequired),
           directoryServerTransactionId: s(c.directoryServerTransactionId), cardholderMessage: s(c.cardholderMessage),
           cavv: s(c.cavv, 255), xid: s(c.xid, 255), ucafAuthenticationData: s(c.ucafAuthenticationData, 255), ucafCollectionIndicator: s(c.ucafCollectionIndicator),
           ecommerceIndicator: s(c.ecommerceIndicator), cardType: s(card.type) }
}
/** Tamaño de ventana del reto (EMVCo challengeWindowSize) leído del pareq; 02 (390×400) si no se puede leer. */
export function ventanaDesdePareq(pareq: unknown): Ventana {
  try {
    const b = String(pareq ?? '').replace(/-/g, '+').replace(/_/g, '/')
    const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (ch) => ch.charCodeAt(0)))) as Record<string, unknown>
    const w = String(j.challengeWindowSize ?? '')
    return (['01', '02', '03', '04', '05'] as const).includes(w as '01') ? (w as Ventana) : '02'
  } catch { return '02' }
}
/** Tabla del manual §9.2 (ancho × alto en px). 05 = pantalla completa (null: la UI usa una capa fija de 100vw × 100vh). */
export const VENTANAS_RETO: Record<Ventana, { w: number; h: number } | null> = { '01': { w: 250, h: 400 }, '02': { w: 390, h: 400 }, '03': { w: 500, h: 600 }, '04': { w: 600, h: 400 }, '05': null }

const motivoPares = (ev: EvidenciaAuth, d: Record<string, unknown>) =>
  `paresStatus=${ev.paresStatus ?? 'ninguno'}${typeof d.status === 'string' ? ` status=${d.status}` : ''}${ev.veresEnrolled ? ` veresEnrolled=${ev.veresEnrolled}` : ''}`

/** Enrolamiento: se decide por paresStatus (política del dueño). */
export function leerEnroll(data: unknown): LecturaEnroll {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const c = (d.consumerAuthenticationInformation && typeof d.consumerAuthenticationInformation === 'object' ? d.consumerAuthenticationInformation : {}) as Record<string, unknown>
  const ev = evidenciaDe(c, d)
  const status = typeof d.status === 'string' ? d.status : ''
  if (!status && !ev.paresStatus) return { ok: false, motivo: 'forma_no_reconocida', detalle: 'sin status ni paresStatus' }
  if (!['AUTHENTICATION_SUCCESSFUL', 'PENDING_AUTHENTICATION', 'AUTHENTICATION_FAILED'].includes(status) && !ev.paresStatus) return { ok: false, motivo: 'forma_no_reconocida', detalle: `status=${status || 'ninguno'}` }
  // Un reto sin paresStatus explícito (PENDING_AUTHENTICATION) se trata como C; cualquier otro valor ausente es rechazo.
  const decision = ev.paresStatus ? politicaPares(ev.paresStatus) : status === 'PENDING_AUTHENTICATION' ? 'reto' : 'rechazar'
  if (decision === 'cobrar' && status !== 'AUTHENTICATION_FAILED') return { ok: true, resultado: 'autenticada', evidencia: ev }
  if (decision === 'reto') {
    const stepUpUrl = String(c.stepUpUrl ?? ''), accessToken = String(c.accessToken ?? '')
    if (!stepUpUrl || !accessToken || !ev.authenticationTransactionId) return { ok: false, motivo: 'reto_incompleto', detalle: 'faltan stepUpUrl/accessToken/authenticationTransactionId' }
    if (!urlEsCardinal(stepUpUrl)) return { ok: false, motivo: 'url_no_cardinal', detalle: 'stepUpUrl fuera de cardinalcommerce.com' }
    return { ok: true, resultado: 'reto', evidencia: ev, stepUpUrl, accessToken, ventana: ventanaDesdePareq(c.pareq) }
  }
  return { ok: true, resultado: 'rechazada', evidencia: ev, motivo: motivoPares(ev, d) }
}

export interface ValidateRequest { clientReferenceInformation: { code: string }; consumerAuthenticationInformation: { authenticationTransactionId: string }; orderInformation: { amountDetails: { currency: 'MXN'; totalAmount: string } }; tokenInformation: { jti: string } }
/** Manual §10.2: los campos de tarjeta se sustituyen con el token transitorio → tokenInformation.jti. */
export function buildValidateRequest(attemptId: string, authenticationTransactionId: string, amount: number, jti: string): ValidateRequest {
  if (!authenticationTransactionId) throw new Error('falta authenticationTransactionId')
  if (!jti || !/^[A-Za-z0-9_-]{1,128}$/.test(jti)) throw new Error('jti inválido')
  return { clientReferenceInformation: { code: attemptId }, consumerAuthenticationInformation: { authenticationTransactionId }, orderInformation: { amountDetails: { currency: 'MXN', totalAmount: amount.toFixed(2) } }, tokenInformation: { jti } }
}
export type LecturaValidate = { ok: true; resultado: 'autenticada' | 'rechazada' | 'pendiente'; evidencia: EvidenciaAuth; motivo?: string } | { ok: false; motivo: 'forma_no_reconocida'; detalle: string }
export function leerValidate(data: unknown): LecturaValidate {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const c = (d.consumerAuthenticationInformation && typeof d.consumerAuthenticationInformation === 'object' ? d.consumerAuthenticationInformation : {}) as Record<string, unknown>
  const ev = evidenciaDe(c, d)
  const status = typeof d.status === 'string' ? d.status : ''
  if (!['AUTHENTICATION_SUCCESSFUL', 'PENDING_AUTHENTICATION', 'AUTHENTICATION_FAILED'].includes(status) && !ev.paresStatus) return { ok: false, motivo: 'forma_no_reconocida', detalle: `status=${status || 'ninguno'}` }
  if (status === 'PENDING_AUTHENTICATION' && (!ev.paresStatus || politicaPares(ev.paresStatus) === 'reto')) return { ok: true, resultado: 'pendiente', evidencia: ev }
  if (politicaPares(ev.paresStatus) === 'cobrar' && status !== 'AUTHENTICATION_FAILED') return { ok: true, resultado: 'autenticada', evidencia: ev }
  return { ok: true, resultado: 'rechazada', evidencia: ev, motivo: motivoPares(ev, d) }
}

/** Lo que persistimos del resultado 3DS en el intento (columnas de CS-1A.1a) y en la bitácora (detalle). Sin cavv, xid, ucaf ni tokens. */
export function datosAvance(ev: EvidenciaAuth, status: string): Record<string, unknown> {
  return { cs_auth_transaction_id: ev.authenticationTransactionId ?? undefined, cs_auth_status: status, cs_eci: ev.eci ?? ev.eciRaw ?? undefined,
           evidencia: undefined,
           detalle_3ds: { paresStatus: ev.paresStatus, veresEnrolled: ev.veresEnrolled, specificationVersion: ev.specificationVersion, effectiveAuthenticationType: ev.effectiveAuthenticationType, challengeRequired: ev.challengeRequired, directoryServerTransactionId: ev.directoryServerTransactionId } }
}

/** Fila de card_payment_3ds_auth (tabla de corta vida, solo servidor). */
export interface Fila3ds {
  attempt_id: string; jti: string; token_exp: string; card_brand: string | null
  authentication_transaction_id: string | null; pares_status: string | null; eci: string | null; eci_raw: string | null; cavv: string | null; xid: string | null
  ucaf_collection_indicator: string | null; ucaf_authentication_data: string | null; directory_server_transaction_id: string | null; specification_version: string | null
  ecommerce_indicator: string | null; fuente: 'setup' | 'enroll' | 'validate'; expires_at: string
}
/** Fila nueva tras el setup: solo jti, expiración y marca; ningún valor 3DS de una tarjeta anterior sobrevive. */
export function fila3dsSetup(attemptId: string, t: { jti: string; exp: Date; marca: string | null }, ahora: Date = new Date()): Fila3ds {
  return { attempt_id: attemptId, jti: t.jti, token_exp: t.exp.toISOString(), card_brand: t.marca, authentication_transaction_id: null, pares_status: null, eci: null, eci_raw: null,
           cavv: null, xid: null, ucaf_collection_indicator: null, ucaf_authentication_data: null, directory_server_transaction_id: null, specification_version: null,
           ecommerce_indicator: null, fuente: 'setup', expires_at: new Date(ahora.getTime() + 60 * 60 * 1000).toISOString() }
}
/**
 * Valores 3DS del enroll (frictionless) o del validate (tras reto, manual §10.1: los del validate REEMPLAZAN). Lo que el validate
 * no traiga se conserva del enroll (p. ej. directoryServerTransactionId). La marca de la respuesta manda sobre la del token.
 */
export function actualizarFila3ds(previa: Fila3ds, ev: EvidenciaAuth, fuente: 'enroll' | 'validate', marca: string | null): Fila3ds {
  const v = <T>(nuevo: T | null, viejo: T | null) => (nuevo ?? viejo)
  return { ...previa, fuente, card_brand: marca ?? previa.card_brand,
           authentication_transaction_id: v(ev.authenticationTransactionId, previa.authentication_transaction_id), pares_status: ev.paresStatus,
           eci: v(ev.eci, fuente === 'validate' ? null : previa.eci), eci_raw: v(ev.eciRaw, fuente === 'validate' ? null : previa.eci_raw),
           cavv: v(ev.cavv, fuente === 'validate' ? null : previa.cavv), xid: v(ev.xid, previa.xid),
           ucaf_collection_indicator: v(ev.ucafCollectionIndicator, fuente === 'validate' ? null : previa.ucaf_collection_indicator),
           ucaf_authentication_data: v(ev.ucafAuthenticationData, fuente === 'validate' ? null : previa.ucaf_authentication_data),
           directory_server_transaction_id: v(ev.directoryServerTransactionId, previa.directory_server_transaction_id),
           specification_version: v(ev.specificationVersion, previa.specification_version), ecommerce_indicator: v(ev.ecommerceIndicator, previa.ecommerce_indicator) }
}

/**
 * ¿Puede seguir este intento con el token que acaba de llegar? Un jti distinto del autenticado = otra captura de tarjeta:
 * la autenticación anterior NO sirve para ella (nunca se cobra una tarjeta nueva con un 3DS viejo).
 */
export function decidirReentrada(estado: string, jtiGuardado: string | null, jtiNuevo: string): 'nuevo' | 'mismo' | 'reautenticar' {
  if (estado === 'created' || estado === 'tokenized') return 'nuevo'
  return jtiGuardado && jtiGuardado === jtiNuevo ? 'mismo' : 'reautenticar'
}

/** Estados del intento en los que cada acción es válida (la máquina real vive en cs_intento_avanzar; esto solo evita llamadas inútiles al proveedor). */
export const ESTADOS_ACCION: Record<'setup' | 'enroll' | 'validate' | 'abandonar', readonly string[]> = {
  setup: ['created', 'tokenized'],
  enroll: ['auth_setup'],
  validate: ['auth_challenge'],
  abandonar: ['created', 'tokenized', 'auth_setup', 'auth_pending', 'auth_challenge'],
}

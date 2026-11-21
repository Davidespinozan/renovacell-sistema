// CS-BB (21 nov 2026) · integración CyberSource alineada al MANUAL DE INTEGRACIÓN de BanBajío. Todo simulado (sin red, sin
// credenciales): firmas RS256 del capture context y del token transitorio, jti/exp del token, política paresStatus del dueño,
// venta por marca (Visa / Mastercard / Amex / Carnet), commerceIndicator, returnUrl en el dominio de la app, página de retorno de
// Netlify, recaptura con 3DS nuevo, mensajes al doctor sin texto técnico, bitácora de pruebas enmascarada y la migración.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import mig from '../../../../../supabase/migrations/20270407410000_cs_bb_3ds_bitacora.sql?raw'
import rollback from '../../../../../supabase/rollback/cs_bb_3ds/99_down.sql?raw'
import edgePago from '../../../../../supabase/functions/cs-pago/index.ts?raw'
import edge3ds from '../../../../../supabase/functions/cs-3ds/index.ts?raw'
import edgeCtx from '../../../../../supabase/functions/cs-capture-context/index.ts?raw'
import edgeComun from '../../../../../supabase/functions/_shared/csEdge.ts?raw'
import retornoSrc from '../../../../../netlify/edge-functions/pago-3ds-retorno.ts?raw'
import {
  verificarJwtCS, verificarTokenTransitorio, leerTokenTransitorio, decodificarJwtCS, conCacheJwk, _limpiarCacheJwkCS, jwkDeRespuesta, rutaLlavePublicaCS, marcaTarjeta,
  type JwkRsa,
} from '../../../../../supabase/functions/_shared/csJwt'
import { enmascararCS, acortarJti, ultimos4, filaBitacora, bitacoraActiva, conBitacora, bitacoraACsv, COLUMNAS_CSV_BITACORA } from '../../../../../supabase/functions/_shared/csBitacora'
import {
  politicaPares, leerEnroll, leerValidate, construirReturnUrl, decidirReentrada, fila3dsSetup, actualizarFila3ds, evidenciaDe, MENSAJE_RECHAZO_3DS, MENSAJE_TARJETA_EXPIRADA,
} from '../../../../../supabase/functions/cs-3ds/contrato'
import {
  buildPaymentRequest, consumerAuthPago, indicadorComercio, normalizarMarca, rutaTransactionMode, mensajeRechazoCliente, reasonDeError, MENSAJE_RECHAZO_GENERICO, type Datos3dsPago,
} from '../../../../../supabase/functions/cs-pago/contrato'
import retorno, { htmlRetorno3ds, leerTransactionId, cabecerasRetorno, config as configRetorno } from '../../../../../netlify/edge-functions/pago-3ds-retorno'
import { mensajeSeguroPago, MENSAJE_GENERICO_PAGO } from './cybersourcePago'

const sinComentarios = (s: string) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
const ATT = '11111111-1111-4111-8111-111111111111'
const JTI = '1C66OQNAOU90VSAO5MCNQJS81OSHNKU814BWGOBTVKXI4LKS9F9767C1F9CE66ED'
const AHORA = new Date('2026-11-21T18:00:00Z')
const b64url = (b: Uint8Array | string) => {
  const u = typeof b === 'string' ? new TextEncoder().encode(b) : b
  let s = ''; for (const x of u) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---- llaves RSA reales (WebCrypto) para firmar JWT de prueba -------------------------------------------------------------
let llaves: CryptoKeyPair
let jwkPublica: JwkRsa
async function firmarJwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'kid-flex-1' }, k: CryptoKey = llaves.privateKey): Promise<string> {
  const datos = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(datos)))
  return `${datos}.${b64url(firma)}`
}
const tokenPayload = (extra: Record<string, unknown> = {}) => ({
  iss: 'Flex/08', jti: JTI, iat: Math.floor(AHORA.getTime() / 1000) - 60, exp: Math.floor(AHORA.getTime() / 1000) + 840,
  content: { paymentInformation: { card: { number: { detectedCardTypes: ['002'], bin: '520000', maskedValue: 'XXXXXXXXXXXX0007' }, expirationMonth: { value: '12' }, expirationYear: { value: '2030' } } } },
  ...extra,
})
beforeEach(async () => {
  _limpiarCacheJwkCS()
  if (!llaves) {
    llaves = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    const j = await crypto.subtle.exportKey('jwk', llaves.publicKey)
    jwkPublica = { kty: 'RSA', n: j.n!, e: j.e!, kid: 'kid-flex-1', use: 'enc' }   // CyberSource publica sus llaves de Flex con use=enc
  }
})

describe('CS-BB · firmas RS256 (manual §3 y token transitorio)', () => {
  it('firma válida con la llave del kid (aunque la JWK diga use=enc); alterada, alg distinto, sin kid o sin llave → rechazo', async () => {
    const obtener = vi.fn(async (kid: string) => (kid === 'kid-flex-1' ? jwkPublica : null))
    const jwt = await firmarJwt(tokenPayload())
    expect(await verificarJwtCS(jwt, obtener)).toMatchObject({ ok: true })
    const [h, p, f] = jwt.split('.')
    const alterado = `${h}.${b64url(JSON.stringify(tokenPayload({ jti: 'OTRO' })))}.${f}`
    expect(await verificarJwtCS(alterado, obtener)).toEqual({ ok: false, motivo: 'firma_invalida' })
    expect(await verificarJwtCS(`${b64url(JSON.stringify({ alg: 'none', kid: 'kid-flex-1' }))}.${p}.`, obtener)).toEqual({ ok: false, motivo: 'no_jwt' })
    expect(await verificarJwtCS(`${b64url(JSON.stringify({ alg: 'HS256', kid: 'kid-flex-1' }))}.${p}.${f}`, obtener)).toEqual({ ok: false, motivo: 'alg_no_permitido' })
    expect(await verificarJwtCS(await firmarJwt(tokenPayload(), { alg: 'RS256' }), obtener)).toEqual({ ok: false, motivo: 'sin_kid' })
    expect(await verificarJwtCS(await firmarJwt(tokenPayload(), { alg: 'RS256', kid: 'kid-desconocido' }), obtener)).toEqual({ ok: false, motivo: 'sin_llave' })
    const otra = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    expect(await verificarJwtCS(await firmarJwt(tokenPayload(), undefined, otra.privateKey), obtener)).toEqual({ ok: false, motivo: 'firma_invalida' })
    expect(await verificarJwtCS('no-es-jwt', obtener)).toEqual({ ok: false, motivo: 'no_jwt' })
  })
  it('llave por kid en GET /flex/v2/public-keys/{kid} del mismo host, en caché por host+kid (una fallida no se guarda)', async () => {
    expect(rutaLlavePublicaCS('kid/1')).toBe('/flex/v2/public-keys/kid%2F1')
    const base = vi.fn(async () => jwkPublica)
    const c = conCacheJwk('apitest.cybersource.com', base)
    const jwt = await firmarJwt(tokenPayload())
    await verificarJwtCS(jwt, c); await verificarJwtCS(jwt, c)
    expect(base).toHaveBeenCalledTimes(1)
    const falla = vi.fn(async () => null)
    const c2 = conCacheJwk('api.cybersource.com', falla)
    await verificarJwtCS(jwt, c2); await verificarJwtCS(jwt, c2)
    expect(falla).toHaveBeenCalledTimes(2)
    expect(jwkDeRespuesta({ keyId: 'x', jwk: { kty: 'RSA', n: 'nn', e: 'AQAB', kid: 'k1', use: 'enc' } }, 'k1')).toEqual({ kty: 'RSA', n: 'nn', e: 'AQAB', kid: 'k1' })
    expect(jwkDeRespuesta({ kty: 'RSA', n: 'nn', e: 'AQAB' }, 'k1')).toEqual({ kty: 'RSA', n: 'nn', e: 'AQAB', kid: 'k1' })
    expect(jwkDeRespuesta({ kty: 'RSA', n: 'nn', e: 'AQAB', kid: 'otro' }, 'k1')).toBeNull()
  })
  it('las Edges verifican antes de usar: capture context (manual §3) y token transitorio en cs-3ds y cs-pago', () => {
    const ctx = sinComentarios(edgeCtx)
    expect(ctx.indexOf('verificarJwtCS(r.data, obtenedorJwkCS(cfg))')).toBeGreaterThan(0)
    expect(ctx.indexOf('verificarJwtCS(r.data')).toBeLessThan(ctx.indexOf('leerCaptureContext(r.data'))
    expect(sinComentarios(edge3ds)).toMatch(/verificarTokenTransitorio\(token, obtenedorJwkCS\(cfg\)\)/)
    expect(sinComentarios(edgePago)).toMatch(/verificarTokenTransitorio\(token, obtenedorJwkCS\(cfg\)\)/)
    expect(sinComentarios(edgeComun)).toMatch(/rutaLlavePublicaCS\(kid\)/)
  })
})

describe('CS-BB · token transitorio: jti, exp (15 min) y marca', () => {
  it('lee jti, expiración, marca (detectedCardTypes), BIN y terminación; nunca PAN ni CVV', async () => {
    const r = leerTokenTransitorio(tokenPayload(), AHORA)
    expect(r).toEqual({ ok: true, token: { jti: JTI, exp: new Date(AHORA.getTime() + 840_000), marca: 'mastercard', bin: '520000', terminacion: '0007' } })
    expect(leerTokenTransitorio(tokenPayload({ jti: '' }), AHORA)).toEqual({ ok: false, motivo: 'sin_jti' })
    expect(leerTokenTransitorio(tokenPayload({ jti: 'a b<script>' }), AHORA)).toEqual({ ok: false, motivo: 'sin_jti' })
    expect(leerTokenTransitorio(tokenPayload({ exp: undefined }), AHORA)).toEqual({ ok: false, motivo: 'sin_expiracion' })
    expect(leerTokenTransitorio(null, AHORA)).toEqual({ ok: false, motivo: 'no_jwt' })
  })
  it('token caducado → código propio `expirado` (la UI pide recapturar, no es un rechazo del banco); firma mala → `firma`', async () => {
    const obtener = async () => jwkPublica
    const vencido = await firmarJwt(tokenPayload({ exp: Math.floor(AHORA.getTime() / 1000) - 1 }))
    expect(await verificarTokenTransitorio(vencido, obtener, AHORA)).toEqual({ ok: false, motivo: 'expirado' })
    const ok = await verificarTokenTransitorio(await firmarJwt(tokenPayload()), obtener, AHORA)
    expect(ok).toMatchObject({ ok: true, token: { jti: JTI } })
    const [h, , f] = (await firmarJwt(tokenPayload())).split('.')
    expect(await verificarTokenTransitorio(`${h}.${b64url(JSON.stringify(tokenPayload({ exp: 9999999999 })))}.${f}`, obtener, AHORA)).toEqual({ ok: false, motivo: 'firma' })
    expect(decodificarJwtCS('a.b')).toBeNull()
    expect(MENSAJE_TARJETA_EXPIRADA).toMatch(/15 minutos.*Vuelve a capturar/)
    for (const [v, m] of [['001', 'visa'], ['002', 'mastercard'], ['003', 'amex'], ['058', 'carnet'], ['VISA', 'visa'], ['MasterCard', 'mastercard'], ['999', null]] as const) expect(marcaTarjeta(v)).toBe(m)
  })
  it('las Edges responden `tarjeta_expirada` (código específico) y nunca guardan el JWT, solo jti y exp', () => {
    const s3 = sinComentarios(edge3ds), sp = sinComentarios(edgePago)
    expect(s3).toMatch(/error: 'tarjeta_expirada', message: MENSAJE_TARJETA_EXPIRADA/); expect(sp).toMatch(/'tarjeta_expirada'/)
    expect(s3).not.toMatch(/upsert\(\{[^}]*token:/)
  })
})

describe('CS-BB · política paresStatus (dueño): Y/A cobrar · C reto · U/N/R/otro rechazo sin cobro', () => {
  it('politicaPares', () => {
    expect(['Y', 'A', 'y'].map(politicaPares)).toEqual(['cobrar', 'cobrar', 'cobrar'])
    expect(politicaPares('C')).toBe('reto')
    for (const p of ['U', 'N', 'R', 'I', 'D', '', null, undefined, 'X']) expect(politicaPares(p as string)).toBe('rechazar')
  })
  const ci = { authenticationTransactionId: 'tx-1', eciRaw: '05', eci: '05', cavv: 'AAABBIcJIoQDIzAgVAkiAAAAAAA=', xid: 'WElEMTIz', directoryServerTransactionId: 'ds-1', specificationVersion: '2.2.0', ecommerceIndicator: 'vbv' }
  const stepUp = { stepUpUrl: 'https://centinelapistag.cardinalcommerce.com/V2/Cruise/StepUp', accessToken: 'jwt.stepup', pareq: btoa(JSON.stringify({ challengeWindowSize: '05' })) }
  it('enrolamiento: decide por paresStatus, no por status', () => {
    expect(leerEnroll({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { ...ci, paresStatus: 'Y' }, paymentInformation: { card: { type: 'VISA' } } }))
      .toMatchObject({ ok: true, resultado: 'autenticada', evidencia: { paresStatus: 'Y', cavv: ci.cavv, ecommerceIndicator: 'vbv', cardType: 'VISA' } })
    expect(leerEnroll({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { ...ci, paresStatus: 'A' } })).toMatchObject({ resultado: 'autenticada' })
    expect(leerEnroll({ status: 'PENDING_AUTHENTICATION', consumerAuthenticationInformation: { ...ci, paresStatus: 'C', ...stepUp } })).toMatchObject({ resultado: 'reto', ventana: '05' })
    for (const p of ['U', 'N', 'R']) expect(leerEnroll({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { ...ci, paresStatus: p } })).toMatchObject({ resultado: 'rechazada' })
    // status dice éxito pero no hay paresStatus → rechazo (no se cobra sin una firma 3DS válida)
    expect(leerEnroll({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { authenticationTransactionId: 'tx' } })).toMatchObject({ resultado: 'rechazada' })
    // paresStatus Y con status FAILED → rechazo (conservador)
    expect(leerEnroll({ status: 'AUTHENTICATION_FAILED', consumerAuthenticationInformation: { ...ci, paresStatus: 'Y' } })).toMatchObject({ resultado: 'rechazada' })
    expect(MENSAJE_RECHAZO_3DS).toMatch(/^Tu banco no pudo autenticar esta tarjeta\. Por favor usa otra tarjeta u otra forma de pago/)
  })
  it('validación tras reto: Y/A autenticada, C/PENDING pendiente, N/U/R rechazada', () => {
    expect(leerValidate({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { paresStatus: 'Y', cavv: 'X' } })).toMatchObject({ resultado: 'autenticada' })
    expect(leerValidate({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { paresStatus: 'A' } })).toMatchObject({ resultado: 'autenticada' })
    expect(leerValidate({ status: 'PENDING_AUTHENTICATION', consumerAuthenticationInformation: { paresStatus: 'C' } })).toMatchObject({ resultado: 'pendiente' })
    for (const p of ['N', 'U', 'R']) expect(leerValidate({ status: 'AUTHENTICATION_FAILED', consumerAuthenticationInformation: { paresStatus: p } })).toMatchObject({ resultado: 'rechazada' })
    expect(leerValidate({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { paresStatus: 'U' } })).toMatchObject({ resultado: 'rechazada' })
  })
  it('cs-3ds: un rechazo 3DS va a declined SIN guardar valores 3DS y con el mensaje §10.5; cs-pago no cobra si paresStatus no es Y/A', () => {
    const s3 = sinComentarios(edge3ds)
    expect(s3).toMatch(/l\.resultado === 'rechazada'\) \{ await avanzar\('declined'[^\n]*await borrar3ds\(\); return json\(200, \{ estado: 'declined', message: MENSAJE_RECHAZO_3DS \}\)/)
    const sp = sinComentarios(edgePago)
    expect(sp.indexOf("politicaPares(auth.pares_status) !== 'cobrar'")).toBeGreaterThan(0)
    expect(sp.indexOf("politicaPares(auth.pares_status) !== 'cobrar'")).toBeLessThan(sp.indexOf("avanzar('authz_sent')"))
  })
})

describe('CS-BB · venta por marca (manual §11–13)', () => {
  const BT = { firstName: 'Maria Jose', lastName: 'Perez Lopez', address1: 'Av. Obregon 1045', locality: 'Culiacan', administrativeArea: 'Sinaloa', postalCode: '80000', country: 'MX', email: 'm@c.mx', phoneNumber: '6671647799' }
  const base: Datos3dsPago = { jti: JTI, token_exp: '2026-11-21T18:15:00Z', card_brand: null, authentication_transaction_id: 'tx-1', pares_status: 'Y', eci: '05', eci_raw: '05', cavv: 'AAABBIcJIoQDIzAgVAkiAAAAAAA=', xid: 'WElEMTIzNA==', ucaf_collection_indicator: '2', ucaf_authentication_data: 'kAABApFSYyd4l2eQQFJjAAAAAAA=', directory_server_transaction_id: 'ds-1', specification_version: '2.2.0', ecommerce_indicator: null }
  it('Visa: cavv, eciRaw, xid, directoryServerTransactionId, paresStatus, authenticationTransactionId + transactionMode S; vbv; capture true; jti', () => {
    const r = buildPaymentRequest({ attemptId: ATT, amount: 102.21, jti: JTI, auth: base, marca: 'visa', commerceIndicator: 'vbv', billTo: BT, modo: 'venta' })
    expect(r.processingInformation).toEqual({ capture: true, commerceIndicator: 'vbv' })
    expect(r.consumerAuthenticationInformation).toEqual({ authenticationTransactionId: 'tx-1', cavv: base.cavv, eciRaw: '05', xid: base.xid, directoryServerTransactionId: 'ds-1', paresStatus: 'Y', strongAuthentication: { transactionMode: 'S' } })
    expect(r.tokenInformation).toEqual({ jti: JTI }); expect(r.clientReferenceInformation).toEqual({ code: ATT }); expect(r.orderInformation.billTo).toEqual(BT)
    expect(Object.keys(r.orderInformation.billTo).sort()).toEqual(['address1', 'administrativeArea', 'country', 'email', 'firstName', 'lastName', 'locality', 'phoneNumber', 'postalCode'])
  })
  it('Amex: mismo conjunto que Visa (manual §12), aesk de respaldo', () => {
    const r = buildPaymentRequest({ attemptId: ATT, amount: 1, jti: JTI, auth: base, marca: 'amex', commerceIndicator: 'aesk', billTo: BT, modo: 'venta' })
    expect(Object.keys(r.consumerAuthenticationInformation).sort()).toEqual(['authenticationTransactionId', 'cavv', 'directoryServerTransactionId', 'eciRaw', 'paresStatus', 'strongAuthentication', 'xid'])
    expect(r.processingInformation.commerceIndicator).toBe('aesk')
  })
  it('Mastercard: eciRaw, ucafCollectionIndicator, ucafAuthenticationData, directoryServerTransactionId, paSpecificationVersion + transactionMode S; sin cavv/xid', () => {
    const r = buildPaymentRequest({ attemptId: ATT, amount: 1, jti: JTI, auth: { ...base, authentication_transaction_id: null }, marca: 'mastercard', commerceIndicator: 'spa', billTo: BT, modo: 'venta' })
    expect(r.consumerAuthenticationInformation).toEqual({ eciRaw: '05', ucafCollectionIndicator: '2', ucafAuthenticationData: base.ucaf_authentication_data, directoryServerTransactionId: 'ds-1', paSpecificationVersion: '2.2.0', strongAuthentication: { transactionMode: 'S' } })
  })
  it('Carnet: conjunto general §11.2 (pendiente confirmar con BanBajío); campos vacíos se omiten; eci si falta eciRaw', () => {
    const c = consumerAuthPago({ ...base, xid: null, eci_raw: null }, 'carnet')
    expect(c).toEqual({ authenticationTransactionId: 'tx-1', cavv: base.cavv, eciRaw: '05', directoryServerTransactionId: 'ds-1', paresStatus: 'Y', strongAuthentication: { transactionMode: 'S' } })
  })
  it('ruta de transactionMode configurable (CS_TRANSACTION_MODE_RUTA=directo) por si el banco la indica sin strongAuthentication', () => {
    expect(rutaTransactionMode(undefined)).toBe('strongAuthentication'); expect(rutaTransactionMode('DIRECTO')).toBe('directo')
    expect(consumerAuthPago(base, 'visa', 'directo')).toMatchObject({ transactionMode: 'S' })
    expect(consumerAuthPago(base, 'visa', 'directo')).not.toHaveProperty('strongAuthentication')
  })
  it('commerceIndicator: el ecommerceIndicator devuelto manda; respaldo vbv/spa/aesk; Carnet solo por variable (sin valor supuesto → falla cerrado)', () => {
    expect(indicadorComercio({ devuelto: 'vbv_attempted', marca: 'visa' })).toEqual({ ok: true, valor: 'vbv_attempted' })
    expect(indicadorComercio({ devuelto: null, marca: 'visa' })).toEqual({ ok: true, valor: 'vbv' })
    expect(indicadorComercio({ devuelto: '', marca: 'mastercard' })).toEqual({ ok: true, valor: 'spa' })
    expect(indicadorComercio({ devuelto: null, marca: 'amex' })).toEqual({ ok: true, valor: 'aesk' })
    expect(indicadorComercio({ devuelto: null, marca: 'carnet' })).toEqual({ ok: false, motivo: 'sin_indicador_carnet' })
    expect(indicadorComercio({ devuelto: null, marca: 'carnet', carnetEnv: '  ' })).toEqual({ ok: false, motivo: 'sin_indicador_carnet' })
    expect(indicadorComercio({ devuelto: null, marca: 'carnet', carnetEnv: 'internet' })).toEqual({ ok: true, valor: 'internet' })
    expect(indicadorComercio({ devuelto: 'carnet3ds', marca: 'carnet' })).toEqual({ ok: true, valor: 'carnet3ds' })
    expect(indicadorComercio({ devuelto: null, marca: null })).toEqual({ ok: false, motivo: 'marca_desconocida' })
    for (const [v, m] of [['visa', 'visa'], ['VISA', 'visa'], ['002', 'mastercard'], ['carnet', 'carnet'], ['x', null]] as const) expect(normalizarMarca(v)).toBe(m)
    const sp = sinComentarios(edgePago)
    expect(sp).toMatch(/carnetEnv: Deno\.env\.get\('CS_COMMERCE_INDICATOR_CARNET'\)/)
    expect(sp.indexOf("return json(500, { error: 'configuracion'")).toBeLessThan(sp.indexOf("avanzar('authz_sent')"))
  })
  it('cs-pago: jti del token = jti autenticado (si no, 3DS nuevo) ANTES del envío; guarda transactionId del procesador; borra los datos 3DS tras enviar', () => {
    const sp = sinComentarios(edgePago)
    expect(sp).toMatch(/if \(auth\.jti !== lt\.token\.jti\) return await cerrarSinCargo\('reautenticar'/)
    expect(sp).toMatch(/admin\.rpc\('cs_intento_procesador', \{ p_attempt: attemptId, p_transaction_id: lp\.evidencia\.processorTransactionId \}\)/)
    expect(sp).toMatch(/llamarCS\(cfg, admin, attemptId, 'pago', \{ metodo: 'POST', ruta: RUTAS_CS\.pagos, cuerpo \}\)\n\s*await borrar3ds\(\)/)
    expect(sp).not.toMatch(/actionList|VALIDATE_CONSUMER_AUTHENTICATION|transientTokenJwt/)
    expect(sp).toMatch(/modoCaptura\(Deno\.env\.get\('CS_MODO_CAPTURA'\)\)/)
  })
})

describe('CS-BB · recaptura de tarjeta y datos 3DS de corta vida', () => {
  it('decidirReentrada: antes del setup → nuevo; mismo jti → mismo; otro jti o sin datos → reautenticar', () => {
    expect(decidirReentrada('created', null, JTI)).toBe('nuevo'); expect(decidirReentrada('tokenized', 'x', JTI)).toBe('nuevo')
    for (const e of ['auth_setup', 'auth_pending', 'auth_challenge', 'auth_validated']) {
      expect(decidirReentrada(e, JTI, JTI)).toBe('mismo'); expect(decidirReentrada(e, 'OTRO', JTI)).toBe('reautenticar'); expect(decidirReentrada(e, null, JTI)).toBe('reautenticar')
    }
  })
  it('setup deja una fila limpia (1 h); enroll llena; validate REEMPLAZA cavv/eci/ucaf (manual §10.1) y conserva lo que no trae', () => {
    const f0 = fila3dsSetup(ATT, { jti: JTI, exp: new Date('2026-11-21T18:14:00Z'), marca: 'visa' }, AHORA)
    expect(f0).toMatchObject({ attempt_id: ATT, jti: JTI, token_exp: '2026-11-21T18:14:00.000Z', card_brand: 'visa', cavv: null, pares_status: null, fuente: 'setup', expires_at: '2026-11-21T19:00:00.000Z' })
    const ev1 = evidenciaDe({ authenticationTransactionId: 'tx-1', paresStatus: 'C', directoryServerTransactionId: 'ds-1', specificationVersion: '2.2.0' }, { paymentInformation: { card: { type: 'VISA' } } })
    const f1 = actualizarFila3ds(f0, ev1, 'enroll', 'visa')
    expect(f1).toMatchObject({ fuente: 'enroll', pares_status: 'C', authentication_transaction_id: 'tx-1', directory_server_transaction_id: 'ds-1', cavv: null })
    const ev2 = evidenciaDe({ paresStatus: 'Y', cavv: 'CAVV-NUEVO', eciRaw: '05', ecommerceIndicator: 'vbv' })
    const f2 = actualizarFila3ds(f1, ev2, 'validate', null)
    expect(f2).toMatchObject({ fuente: 'validate', pares_status: 'Y', cavv: 'CAVV-NUEVO', eci_raw: '05', ecommerce_indicator: 'vbv', authentication_transaction_id: 'tx-1', directory_server_transaction_id: 'ds-1', specification_version: '2.2.0', card_brand: 'visa', jti: JTI })
  })
  it('cs-3ds: otro token en un intento ya autenticado → failed_safe_to_retry + reautenticar (nunca "completada" con 3DS viejo)', () => {
    const s3 = sinComentarios(edge3ds)
    expect(s3).toMatch(/if \(re === 'mismo'\) return json\(409, \{ error: 'estado_invalido'/)
    expect(s3).toMatch(/return await reautenticar\('tarjeta recapturada/)
    expect(s3).toMatch(/await avanzar\('failed_safe_to_retry', \{ error: motivo \}\)/)
  })
})

describe('CS-BB · returnUrl en el dominio de la app y página de retorno (Netlify)', () => {
  it('construirReturnUrl: origen permitido + /pago/3ds-retorno; CS_RETURN_URL solo si coincide con el origen', () => {
    expect(construirReturnUrl({ origen: 'https://portal.renovacell.mx', origenPermitido: true })).toEqual({ ok: true, url: 'https://portal.renovacell.mx/pago/3ds-retorno', origen: 'https://portal.renovacell.mx' })
    expect(construirReturnUrl({ origen: 'https://portal.renovacell.mx', origenPermitido: false })).toEqual({ ok: false, motivo: 'origen_no_permitido' })
    expect(construirReturnUrl({ origen: '', origenPermitido: true })).toEqual({ ok: false, motivo: 'origen_no_permitido' })
    expect(construirReturnUrl({ origen: 'http://evil.test', origenPermitido: true })).toEqual({ ok: false, motivo: 'origen_no_permitido' })
    expect(construirReturnUrl({ origen: 'https://portal.renovacell.mx', origenPermitido: true, envReturnUrl: 'https://portal.renovacell.mx/pago/3ds-retorno' })).toMatchObject({ ok: true })
    expect(construirReturnUrl({ origen: 'https://portal.renovacell.mx', origenPermitido: true, envReturnUrl: 'https://x.supabase.co/functions/v1/cs-3ds-return' })).toEqual({ ok: false, motivo: 'retorno_invalido' })
    expect(construirReturnUrl({ origen: 'https://portal.renovacell.mx', origenPermitido: true, envReturnUrl: 'https://otro.renovacell.mx/pago/3ds-retorno' })).toEqual({ ok: false, motivo: 'retorno_invalido' })
  })
  it('página: solo POST; lee TransactionId del form; postMessage al padre con targetOrigin = su propio origen; script con nonce y CSP', async () => {
    expect(configRetorno).toEqual({ path: '/pago/3ds-retorno' })
    const get = await retorno(new Request('https://portal.renovacell.mx/pago/3ds-retorno'))
    expect(get.status).toBe(405)
    const post = await retorno(new Request('https://portal.renovacell.mx/pago/3ds-retorno', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'TransactionId=BwNsDeDPsQV4q8uy1Kq1&MD=null' }))
    expect(post.status).toBe(200)
    expect(post.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const csp = post.headers.get('content-security-policy') ?? ''
    const nonce = /'nonce-([a-f0-9]+)'/.exec(csp)?.[1]
    expect(nonce).toBeTruthy(); expect(csp).toContain("default-src 'none'"); expect(csp).toContain("frame-ancestors 'self'")
    const html = await post.text()
    expect(html).toContain(`<script nonce="${nonce}">`)
    expect(html).toContain('window.parent.postMessage({"tipo":"cs-3ds-retorno","transactionId":"BwNsDeDPsQV4q8uy1Kq1"},window.location.origin)')
    expect(html).not.toMatch(/"\*"|fetch\(|XMLHttpRequest|localStorage|MD/)
    expect(await leerTransactionId(new Request('https://x/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'TransactionId=%3Cscript%3E' }))).toBeNull()
    expect(htmlRetorno3ds(null, 'n')).toContain('"transactionId":null')
    expect(htmlRetorno3ds('a</script>', 'n')).not.toContain('</script>","')
    expect(cabecerasRetorno('n')['Cache-Control']).toBe('no-store')
    expect(sinComentarios(retornoSrc)).not.toMatch(/https:\/\/edge\.netlify\.com|createClient|Deno\.env|supabase/)
  })
})

describe('CS-BB · mensajes al doctor (nunca texto técnico de CyberSource)', () => {
  it('mapa por motivo y genérico; reason desde el error HTTP', () => {
    expect(mensajeRechazoCliente('INSUFFICIENT_FUND')).toMatch(/fondos/)
    expect(mensajeRechazoCliente('expired_card')).toMatch(/vencida/)
    expect(mensajeRechazoCliente('CONSUMER_AUTHENTICATION_FAILED')).toMatch(/no pudo autenticar/)
    expect(mensajeRechazoCliente('PROCESSOR_DECLINED')).toBe(MENSAJE_RECHAZO_GENERICO)
    expect(mensajeRechazoCliente(null)).toBe(MENSAJE_RECHAZO_GENERICO)
    expect(reasonDeError({ status: 'INVALID_REQUEST', reason: 'MISSING_FIELD', message: 'Declined - The request is missing one or more fields' })).toBe('MISSING_FIELD')
    expect(reasonDeError({ errorInformation: { reason: 'EXPIRED_CARD' } })).toBe('EXPIRED_CARD')
    for (const m of [mensajeRechazoCliente('X'), mensajeRechazoCliente('INSUFFICIENT_FUND'), MENSAJE_RECHAZO_GENERICO]) expect(m).not.toMatch(/CyberSource|[A-Z]{4,}_|status/)
  })
  it('cs-pago ya no devuelve r.mensaje ni el motivo crudo como detalle', () => {
    const sp = sinComentarios(edgePago)
    expect(sp).not.toMatch(/detalle: r\.mensaje|detalle: lp\.motivo|detalle: rc\.mensaje|message: \(e as Error\)\.message/)
    expect(sp).toMatch(/detalle: mensajeRechazoCliente\(reasonDeError\(r\.data\)\)/)
    expect(sp).toMatch(/detalle: mensajeRechazoCliente\(lp\.evidencia\.reason\)/)
  })
  it('red de seguridad del portal: texto técnico → genérico; texto en español pasa', () => {
    for (const t of ['DECLINED · INSUFFICIENT_FUND', 'CyberSource 400: INVALID_REQUEST', 'status=AUTHORIZED_RISK_DECLINED', 'paresStatus=N', '{"reason":"x"}']) expect(mensajeSeguroPago(t)).toBe(MENSAJE_GENERICO_PAGO)
    expect(mensajeSeguroPago('Tu banco rechazó el pago por fondos o límite insuficiente.')).toBe('Tu banco rechazó el pago por fondos o límite insuficiente.')
    expect(mensajeSeguroPago(null)).toBe('')
  })
})

describe('CS-BB · bitácora de pruebas (casos 3DS 2.1–2.11)', () => {
  it('enmascarado: jti acortado, cavv/xid/ucafAuthenticationData con 4 últimos, sin tokens, JWT, PAN ni secretos', () => {
    const req = { clientReferenceInformation: { code: ATT }, tokenInformation: { jti: JTI }, paymentInformation: { card: { number: '4000000000002701', securityCode: '123' } },
                  consumerAuthenticationInformation: { cavv: 'AAABBIcJIoQDIzAgVAkiAAAAAAA=', xid: 'WElEMTIzNA==', ucafAuthenticationData: 'kAABApFSYyd4l2eQQFJjAAAAAAA=', eciRaw: '05', accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiIwYTY4NmYzYyJ9.as3SyS8rjoHQ1', pareq: 'eyJtZXNzYWdlVHlwZSI6IkNSZXEi' },
                  nota: 'tarjeta 4111111111111111', firma: 'eyJraWQiOiJ6dSIsImFsZyI6IlJTMjU2In0.eyJmbHgiOnsicGF0aCI6Ii9mbGV4.AsQtEJk-fLdSR7_4KbbWx' }
    const m = enmascararCS(req) as Record<string, any>
    expect(m.tokenInformation.jti).toBe('1C66OQ…66ED'); expect(acortarJti(JTI)).toBe('1C66OQ…66ED')
    expect(m.consumerAuthenticationInformation.cavv).toBe('••••AAA='); expect(m.consumerAuthenticationInformation.xid).toBe('••••NA=='); expect(m.consumerAuthenticationInformation.ucafAuthenticationData).toBe('••••AAA=')
    expect(m.consumerAuthenticationInformation.eciRaw).toBe('05')
    expect(m.consumerAuthenticationInformation.accessToken).toBe('‹oculto›'); expect(m.consumerAuthenticationInformation.pareq).toBe('‹oculto›')
    expect(m.paymentInformation.card).toEqual({ number: '‹oculto›', securityCode: '‹oculto›' })
    expect(m.nota).toBe('tarjeta ‹número›'); expect(m.firma).toBe('‹jwt›'); expect(m.clientReferenceInformation.code).toBe(ATT)
    const plano = JSON.stringify(m)
    for (const secreto of [JTI, 'AAABBIcJIoQDIzAgVAkiAAAAAAA=', '4000000000002701', '4111111111111111', 'as3SyS8rjoHQ1', '"123"']) expect(plano).not.toContain(secreto)
    expect(ultimos4('abc')).toBe('••••')
  })
  it('solo sandbox: ambiente test (host de pruebas o CS_ENTORNO=sandbox); producción nunca registra', () => {
    expect(bitacoraActiva({ ambiente: 'test', host: 'apitest.cybersource.com' }, undefined)).toBe(true)
    expect(bitacoraActiva({ ambiente: 'test', host: 'otro' }, 'sandbox')).toBe(true)
    expect(bitacoraActiva({ ambiente: 'test', host: 'otro' }, undefined)).toBe(false)
    expect(bitacoraActiva({ ambiente: 'production', host: 'api.cybersource.com' }, 'sandbox')).toBe(false)
    expect(bitacoraActiva({ ambiente: 'production', host: 'apitest.cybersource.com' }, 'sandbox')).toBe(false)
  })
  it('conBitacora: registra paso, hora, HTTP, cuerpos enmascarados; sin bitácora no guarda; un fallo al guardar no rompe el pago', async () => {
    const guardadas: unknown[] = []
    let t = 1000
    const r = await conBitacora({ activa: true, attemptId: ATT, paso: 'setup', metodo: 'POST', ruta: '/risk/v1/authentication-setups', cuerpo: { tokenInformation: { jti: JTI } }, guardar: async (f) => { guardadas.push(f) }, ahora: () => (t += 37) },
      async () => ({ ok: true as const, status: 201, data: { status: 'COMPLETED', consumerAuthenticationInformation: { accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiIwYTY4In0.as3SyS8rjoHQ1', referenceId: 'ref-1' } } }))
    expect(r.ok).toBe(true)
    expect(guardadas).toHaveLength(1)
    expect(guardadas[0]).toMatchObject({ attempt_id: ATT, paso: 'setup', metodo: 'POST', ruta: '/risk/v1/authentication-setups', http_status: 201, resultado: 'ok', duracion_ms: 37, ambiente: 'test',
                                         request: { tokenInformation: { jti: '1C66OQ…66ED' } }, response: { status: 'COMPLETED', consumerAuthenticationInformation: { accessToken: '‹oculto›', referenceId: 'ref-1' } } })
    const g2 = vi.fn()
    await conBitacora({ activa: false, attemptId: ATT, paso: 'pago', metodo: 'POST', ruta: '/pts/v2/payments', cuerpo: {}, guardar: g2 }, async () => ({ ok: true as const, status: 201, data: {} }))
    expect(g2).not.toHaveBeenCalled()
    const r3 = await conBitacora({ activa: true, attemptId: ATT, paso: 'pago', metodo: 'POST', ruta: '/pts/v2/payments', cuerpo: {}, guardar: async () => { throw new Error('db caída') } }, async () => ({ ok: false as const, clase: 'resultado_desconocido' as const }))
    expect(r3).toEqual({ ok: false, clase: 'resultado_desconocido' })
    expect(filaBitacora({ attemptId: ATT, paso: 'captura', metodo: 'POST', ruta: '/pts/v2/payments/7412974173486618904805/captures', cuerpo: null, r: { ok: false, clase: 'http', status: 400, data: { reason: 'X' } }, inicio: 0, fin: 5 }))
      .toMatchObject({ ruta: '/pts/v2/payments/‹id›/captures', http_status: 400, resultado: 'http', response: { reason: 'X' } })
  })
  it('CSV con encabezados y celdas escapadas', () => {
    const csv = bitacoraACsv([{ created_at: '2026-11-21T18:00:00Z', attempt_id: ATT, paso: 'enroll', metodo: 'POST', ruta: '/risk/v1/authentications', http_status: 201, resultado: 'ok', duracion_ms: 120, request: { a: 'x,"y"' }, response: null }])
    const [h, l] = csv.split('\r\n')
    expect(h).toBe(COLUMNAS_CSV_BITACORA.join(','))
    expect(l).toBe(`2026-11-21T18:00:00Z,${ATT},enroll,POST,/risk/v1/authentications,201,ok,120,"{""a"":""x,\\""y\\""""}",`)
  })
  it('todas las llamadas de las Edges pasan por la bitácora (llamarCS) con su paso', () => {
    expect(sinComentarios(edgeCtx)).toMatch(/llamarCS<string>\(cfg, admin, a\.attempt_id, 'capture_context'/)
    const s3 = sinComentarios(edge3ds)
    for (const paso of ['setup', 'enroll', 'validate']) expect(s3).toMatch(new RegExp(`llamarCS\\(cfg, admin, attemptId, '${paso}'`))
    expect(s3).not.toMatch(/solicitarCS\(/)
    const sp = sinComentarios(edgePago)
    expect(sp).toMatch(/llamarCS\(cfg, admin, attemptId, 'pago'/); expect(sp).toMatch(/llamarCS\(cfg, admin, attemptId, 'captura'/); expect(sp).not.toMatch(/solicitarCS\(/)
    expect(sinComentarios(edgeComun)).toMatch(/bitacoraActiva\(cfg, Deno\.env\.get\('CS_ENTORNO'\)\)/)
  })
})

describe('CS-BB · migración 20270407410000 (datos 3DS de corta vida + bitácora)', () => {
  const sql = mig.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
  it('card_payment_3ds_auth: RLS, sin permisos para anon/authenticated, solo service_role; caduca a la hora; sin PAN/CVV', () => {
    expect(sql).toMatch(/create table public\.card_payment_3ds_auth \(/)
    expect(sql).toMatch(/alter table public\.card_payment_3ds_auth enable row level security/)
    expect(sql).toMatch(/revoke all on public\.card_payment_3ds_auth from public, anon, authenticated/)
    expect(sql).toMatch(/grant select, insert, update, delete on public\.card_payment_3ds_auth to service_role/)
    expect(sql).not.toMatch(/grant [^;]*card_payment_3ds_auth[^;]*to (anon|authenticated)/)
    expect(sql).toMatch(/expires_at\s+timestamptz not null default clock_timestamp\(\) \+ interval '1 hour'/)
    const tabla = /create table public\.card_payment_3ds_auth \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? ''
    expect(tabla).not.toMatch(/\b(pan|card_number|cvv|cvn|security_code|transient_token)\b/i)
  })
  it('limpieza en la tarea existente (cs_intentos_expirar, misma expiración de la 184) + rollback a la 184', () => {
    expect(sql).toMatch(/create or replace function public\.cs_intentos_expirar\(\) returns integer/)
    expect(sql).toMatch(/delete from public\.card_payment_3ds_auth d\s+where d\.expires_at < clock_timestamp\(\)/)
    expect(sql).toMatch(/status_at < clock_timestamp\(\) - interval '15 minutes'/)
    expect(rollback).toMatch(/drop table if exists public\.card_payment_3ds_auth/)
    expect(rollback).not.toMatch(/card_payment_3ds_auth d/)
  })
  it('bitácora: solo ambiente test, lectura por RPC de Dirección, inserción de servidor; id del procesador por RPC de servidor', () => {
    expect(sql).toMatch(/ambiente\s+text not null check \(ambiente = 'test'\)/)
    expect(sql).toMatch(/revoke all on public\.cs_bitacora_pruebas from public, anon, authenticated/)
    expect(sql).toMatch(/grant select, insert on public\.cs_bitacora_pruebas to service_role/)
    for (const f of ['cs_bitacora_pruebas_contar', 'cs_bitacora_pruebas_ver']) expect(sql).toMatch(new RegExp(`function public\\.${f}\\([^)]*\\)[\\s\\S]*?public\\.auth_role\\(\\) <> 'admin'`))
    expect(sql).toMatch(/alter table public\.card_payment_attempts add column cs_processor_transaction_id text/)
    expect(sql).toMatch(/->> 'role', ''\) <> 'service_role' then\s+raise exception 'NO_AUTORIZADO: solo el servidor registra el id del procesador'/)
    expect(sql).toMatch(/grant execute on function public\.cs_intento_procesador\(uuid, text\) to service_role;/)
    expect(sql).not.toMatch(/grant execute on function public\.cs_intento_procesador\(uuid, text\) to [^;]*authenticated/)
  })
})

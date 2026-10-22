// CS-1A.4 · contratos 3DS puros (setup / enrolamiento / validación / dispositivo / bill-to / ventana / retorno) + guardas de fuente
// de las Edges `cs-3ds` y `cs-3ds-return`. Todo simulado: ningún caso aquí cuenta como validado en Sandbox.
import { describe, it, expect } from 'vitest'
import edge from '../../../../../supabase/functions/cs-3ds/index.ts?raw'
import retorno from '../../../../../supabase/functions/cs-3ds-return/index.ts?raw'
import {
  ORIGENES_DDC, RUTA_RETORNO_3DS, urlEsCardinal, buildSetupRequest, leerSetup, normalizarDispositivo, buildBillTo, partirNombre, buildEnrollRequest,
  leerEnroll, ventanaDesdePareq, VENTANAS_RETO, buildValidateRequest, leerValidate, datosAvance, ESTADOS_ACCION, htmlRetorno3ds,
} from '../../../../../supabase/functions/cs-3ds/contrato'

const TOKEN = 'eyJraWQiOiIwOCJ9.eyJqdGkiOiJ0cmFuc2llbnRlIn0.firma'
const ATT = '11111111-1111-4111-8111-111111111111'
const DISP = { httpBrowserLanguage: 'es-MX', httpBrowserJavaEnabled: false, httpBrowserJavaScriptEnabled: true, httpBrowserColorDepth: '24', httpBrowserScreenHeight: '864', httpBrowserScreenWidth: '1536', httpBrowserTimeDifference: '360' }
const CAB = { accept: 'application/json', userAgent: 'Mozilla/5.0 (prueba)', ip: '187.190.1.2, 10.0.0.1' }
const ADDR = { line1: 'Av. Álvaro Obregón 1045', colonia: 'Centro', cp: '80000', city: 'Culiacán', state: 'Sinaloa', country: 'México', nombre: 'María José Pérez López', phone: '(667) 164-7799' }

describe('CS-1A.4 · setup', () => {
  it('request oficial: solo code + transientToken; el token debe ser un JWT', () => {
    expect(buildSetupRequest(ATT, TOKEN)).toEqual({ clientReferenceInformation: { code: ATT }, tokenInformation: { transientToken: TOKEN } })
    expect(() => buildSetupRequest(ATT, 'no-jwt')).toThrow('token transitorio inválido')
  })
  it('lectura: COMPLETED con referenceId/accessToken/ddcUrl de Cardinal; FAILED, incompleto y URL ajena se rechazan', () => {
    const ok = { status: 'COMPLETED', consumerAuthenticationInformation: { referenceId: 'ref-1', accessToken: 'jwt.cardinal', deviceDataCollectionUrl: 'https://centinelapistag.cardinalcommerce.com/V1/Cruise/Collect' } }
    expect(leerSetup(ok)).toEqual({ ok: true, referenceId: 'ref-1', accessToken: 'jwt.cardinal', ddcUrl: 'https://centinelapistag.cardinalcommerce.com/V1/Cruise/Collect' })
    expect(leerSetup({ status: 'FAILED' })).toMatchObject({ ok: false, motivo: 'fallido' })
    expect(leerSetup({ status: 'COMPLETED', consumerAuthenticationInformation: { referenceId: 'r' } })).toMatchObject({ ok: false, motivo: 'incompleto' })
    expect(leerSetup({ ...ok, consumerAuthenticationInformation: { ...ok.consumerAuthenticationInformation, deviceDataCollectionUrl: 'https://evil.example/collect' } })).toMatchObject({ ok: false, motivo: 'url_no_cardinal' })
    expect(urlEsCardinal('http://centinelapistag.cardinalcommerce.com/x')).toBe(false)
    expect(urlEsCardinal('https://notcardinalcommerce.com/x')).toBe(false)
    expect(ORIGENES_DDC).toEqual({ test: 'https://centinelapistag.cardinalcommerce.com', production: 'https://centinelapi.cardinalcommerce.com' })
  })
})

describe('CS-1A.4 · dispositivo y bill-to', () => {
  it('normaliza los 11 campos del navegador (cabeceras del servidor + navegador); rechaza si faltan pantalla o user agent', () => {
    const d = normalizarDispositivo(DISP, CAB)
    expect(d).toEqual({ ...DISP, httpAcceptBrowserValue: 'application/json', httpAcceptContent: 'application/json', userAgentBrowserValue: 'Mozilla/5.0 (prueba)', ipAddress: '187.190.1.2' })
    expect(normalizarDispositivo({ ...DISP, httpBrowserLanguage: '<script>', httpBrowserColorDepth: '999' }, CAB)).toMatchObject({ httpBrowserLanguage: 'es-MX', httpBrowserColorDepth: '24' })
    expect(normalizarDispositivo({ ...DISP, httpBrowserScreenHeight: '' }, CAB)).toBeNull()
    expect(normalizarDispositivo(DISP, { ...CAB, userAgent: null })).toBeNull()
    expect(normalizarDispositivo(DISP, { ...CAB, ip: 'no-ip' })?.ipAddress).toBeUndefined()
  })
  it('bill-to desde el domicilio del pedido: nombre partido, sin acentos, CP de 5, teléfono de 10, país MX; lista exacta de faltantes', () => {
    const r = buildBillTo({ nombre: ADDR.nombre, email: 'Maria@Clinica.mx', phone: ADDR.phone, address: ADDR })
    expect(r).toEqual({ ok: true, billTo: { firstName: 'Maria Jose', lastName: 'Perez Lopez', address1: 'Av. Alvaro Obregon 1045', locality: 'Culiacan', administrativeArea: 'Sinaloa', postalCode: '80000', country: 'MX', email: 'maria@clinica.mx', phoneNumber: '6671647799' } })
    expect(partirNombre('Juan Perez')).toEqual({ firstName: 'Juan', lastName: 'Perez' }); expect(partirNombre('Cher')).toEqual({ firstName: 'Cher', lastName: 'Cher' }); expect(partirNombre('')).toEqual({ firstName: '', lastName: '' })
    expect(buildBillTo({ nombre: 'Ana Ruiz', email: 'ana@x', phone: '123', address: { line1: 'Calle 1', cp: '1234' } })).toEqual({ ok: false, faltan: ['locality', 'administrativeArea', 'email', 'postalCode', 'phoneNumber'] })
    expect(buildBillTo({ address: null })).toMatchObject({ ok: false })
  })
})

describe('CS-1A.4 · enrolamiento', () => {
  const bt = (buildBillTo({ nombre: ADDR.nombre, email: 'm@c.mx', phone: ADDR.phone, address: ADDR }) as { ok: true; billTo: never }).billTo
  const disp = normalizarDispositivo(DISP, CAB)!
  it('request oficial: importe del servidor con 2 decimales, MXN, referenceId, returnUrl, modo S, canal Browser, token y dispositivo', () => {
    const r = buildEnrollRequest({ attemptId: ATT, token: TOKEN, amount: 6000, billTo: bt, referenceId: 'ref-1', returnUrl: 'https://x.supabase.co/functions/v1/cs-3ds-return', dispositivo: disp })
    expect(r).toEqual({ clientReferenceInformation: { code: ATT }, orderInformation: { amountDetails: { currency: 'MXN', totalAmount: '6000.00' }, billTo: bt }, tokenInformation: { transientToken: TOKEN },
                        consumerAuthenticationInformation: { referenceId: 'ref-1', returnUrl: 'https://x.supabase.co/functions/v1/cs-3ds-return', transactionMode: 'S', deviceChannel: 'Browser' }, deviceInformation: disp })
    expect(RUTA_RETORNO_3DS).toBe('/functions/v1/cs-3ds-return')
    expect(() => buildEnrollRequest({ attemptId: ATT, token: TOKEN, amount: 0, billTo: bt, referenceId: 'r', returnUrl: 'u', dispositivo: disp })).toThrow('importe')
    expect(() => buildEnrollRequest({ attemptId: ATT, token: TOKEN, amount: 1, billTo: bt, referenceId: '', returnUrl: 'u', dispositivo: disp })).toThrow('referenceId')
    expect(JSON.stringify(r)).not.toMatch(/\b4111\d{12}\b|cvv|securityCode/i)
  })
  it('lectura: frictionless, reto (stepUp de Cardinal + ventana del pareq), rechazada, no reconocida, reto incompleto, URL ajena', () => {
    const ci = { authenticationTransactionId: 'tx-1', eci: '05', eciRaw: '05', paresStatus: 'Y', veresEnrolled: 'Y', specificationVersion: '2.2.0', effectiveAuthenticationType: 'FR', challengeRequired: 'N' }
    const fr = leerEnroll({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: ci })
    expect(fr).toMatchObject({ ok: true, resultado: 'autenticada', evidencia: { authenticationTransactionId: 'tx-1', eci: '05', paresStatus: 'Y', veresEnrolled: 'Y', effectiveAuthenticationType: 'FR' } })
    const pareq = btoa(JSON.stringify({ messageType: 'CReq', challengeWindowSize: '03' })).replace(/=+$/, '')
    const reto = leerEnroll({ status: 'PENDING_AUTHENTICATION', consumerAuthenticationInformation: { ...ci, challengeRequired: 'Y', stepUpUrl: 'https://centinelapistag.cardinalcommerce.com/V2/Cruise/StepUp', accessToken: 'jwt.stepup', pareq } })
    expect(reto).toMatchObject({ ok: true, resultado: 'reto', stepUpUrl: 'https://centinelapistag.cardinalcommerce.com/V2/Cruise/StepUp', accessToken: 'jwt.stepup', ventana: '03' })
    expect(ventanaDesdePareq('no-base64!!')).toBe('02'); expect(ventanaDesdePareq(btoa('{"challengeWindowSize":"09"}'))).toBe('02'); expect(VENTANAS_RETO['05']).toBeNull(); expect(VENTANAS_RETO['02']).toEqual({ w: 390, h: 400 })
    expect(leerEnroll({ status: 'AUTHENTICATION_FAILED', message: 'Authentication failed', consumerAuthenticationInformation: { ...ci, paresStatus: 'N' } })).toMatchObject({ ok: true, resultado: 'rechazada', motivo: 'Authentication failed' })
    expect(leerEnroll({ status: 'INVALID_REQUEST' })).toMatchObject({ ok: false, motivo: 'forma_no_reconocida' })
    expect(leerEnroll({ status: 'PENDING_AUTHENTICATION', consumerAuthenticationInformation: { authenticationTransactionId: 'tx' } })).toMatchObject({ ok: false, motivo: 'reto_incompleto' })
    expect(leerEnroll({ status: 'PENDING_AUTHENTICATION', consumerAuthenticationInformation: { ...ci, stepUpUrl: 'https://evil.example/stepup', accessToken: 'x' } })).toMatchObject({ ok: false, motivo: 'url_no_cardinal' })
  })
  it('tarjeta no inscrita: sigue el status oficial (SUCCESSFUL con veresEnrolled U/B) y la evidencia lo deja escrito para la política de autorización', () => {
    const r = leerEnroll({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { authenticationTransactionId: 'tx-2', veresEnrolled: 'U', paresStatus: 'U' } })
    expect(r).toMatchObject({ ok: true, resultado: 'autenticada', evidencia: { veresEnrolled: 'U', paresStatus: 'U', eci: null } })
    if (!r.ok || r.resultado !== 'autenticada') throw new Error('lectura inesperada')
    const d = datosAvance(r.evidencia, 'AUTHENTICATION_SUCCESSFUL')
    expect(d).toMatchObject({ cs_auth_transaction_id: 'tx-2', cs_auth_status: 'AUTHENTICATION_SUCCESSFUL', detalle_3ds: { veresEnrolled: 'U', paresStatus: 'U' } })
    expect(JSON.stringify(d)).not.toMatch(/cavv|xid|accessToken|transientToken|pareq/)
  })
})

describe('CS-1A.4 · validación', () => {
  it('request: code + authenticationTransactionId del servidor + importe; sin tarjeta ni token', () => {
    expect(buildValidateRequest(ATT, 'tx-1', 6000)).toEqual({ clientReferenceInformation: { code: ATT }, consumerAuthenticationInformation: { authenticationTransactionId: 'tx-1' }, orderInformation: { amountDetails: { currency: 'MXN', totalAmount: '6000.00' } } })
    expect(() => buildValidateRequest(ATT, '', 1)).toThrow('authenticationTransactionId')
  })
  it('lectura: autenticada, rechazada, pendiente (reto sin terminar), no reconocida', () => {
    expect(leerValidate({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { eci: '05', paresStatus: 'Y' } })).toMatchObject({ ok: true, resultado: 'autenticada', evidencia: { eci: '05' } })
    expect(leerValidate({ status: 'AUTHENTICATION_FAILED', message: 'no' })).toMatchObject({ ok: true, resultado: 'rechazada', motivo: 'no' })
    expect(leerValidate({ status: 'PENDING_AUTHENTICATION' })).toMatchObject({ ok: true, resultado: 'pendiente' })
    expect(leerValidate({})).toMatchObject({ ok: false, motivo: 'forma_no_reconocida' })
  })
  it('estados por acción y página de retorno sin lógica', () => {
    expect(ESTADOS_ACCION).toEqual({ setup: ['created', 'tokenized'], enroll: ['auth_setup'], validate: ['auth_challenge'], abandonar: ['created', 'tokenized', 'auth_setup', 'auth_pending', 'auth_challenge'] })
    const h = htmlRetorno3ds()
    expect(h).toContain('postMessage({tipo:"renovacell-3ds-return"},"*")')
    expect(h).not.toMatch(/TransactionId|MD=|fetch\(|XMLHttpRequest|localStorage/)
  })
})

describe('CS-1A.4 · guardas de fuente', () => {
  const src = edge.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  it('cs-3ds: autentica, exige doctor verificado o Dirección, lee el intento con el JWT del llamante, valida estados antes de llamar, avanza por RPC y nunca persiste el token', () => {
    expect(src).toMatch(/resolverQuien\(caller, admin\)/); expect(src).toMatch(/q\.quien\.role === 'doctor' && q\.quien\.verified/)
    expect(src).toMatch(/caller\.from\('card_payment_attempts'\)/); expect(src).toMatch(/intento\.doctor_id !== q\.quien\.uid/)
    expect(src).toMatch(/ESTADOS_ACCION/); expect(src).toMatch(/admin\.rpc\('cs_intento_avanzar'/)
    expect(src).toMatch(/RUTAS_CS\.payerSetup/); expect(src).toMatch(/RUTAS_CS\.payerEnroll/); expect(src).toMatch(/RUTAS_CS\.payerValidate/)
    expect(src).toMatch(/cfg\.ambiente !== intento\.ambiente/)
    expect(src).not.toMatch(/p_datos: \{[^}]*token/); expect(src).not.toMatch(/console\.(log|warn|error)/)
  })
  it('cs-3ds: no cobra, no autoriza, no captura, no contabiliza, no libera reservas, no acepta importes/referencias del navegador', () => {
    expect(src).not.toMatch(/RUTAS_CS\.(pagos|reversals|captureContext)|pts\/v2|registrar_cobro|cs_intento_contabilizar|payOrder|'captured'|'authorized'|'posted'/)
    expect(src).not.toMatch(/p\.(amount|importe|ambiente|merchant|reference_id|authenticationTransactionId|cs_auth_transaction_id|step_up_url|returnUrl)/)
    expect(src).not.toMatch(/'expired'|unknown_requires_reconciliation'\s*\)/)   // ni expira ni reconcilia desde aquí
    expect(src).toMatch(/avanzar\('auth_pending'\)/); expect(src).toMatch(/avanzar\('auth_validated'/); expect(src).toMatch(/avanzar\('declined'/); expect(src).toMatch(/avanzar\('auth_challenge'/); expect(src).toMatch(/avanzar\('failed_safe_to_retry'/)
    expect(src).not.toMatch(/sharedSecret|keyId|firma\.headers|Signature/)
  })
  it('cs-3ds-return: página estática sin base de datos, sin red, sin lectura del TransactionId', () => {
    const ret = retorno.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    expect(ret).toMatch(/htmlRetorno3ds\(\)/)
    expect(ret).not.toMatch(/createClient|fetch\(|Deno\.env|TransactionId|formData|req\.json/)
    expect(ret).toMatch(/Cache-Control': 'no-store'/)
  })
})

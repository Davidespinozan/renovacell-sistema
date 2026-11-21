// CS-1A.4 · contratos 3DS puros (setup / enrolamiento / validación / dispositivo / bill-to / ventana) + guardas de fuente de la Edge
// `cs-3ds`. CS-BB (21 nov 2026): actualizado al manual de BanBajío — jti en vez de transientToken, deviceChannel 'BROWSER',
// buyerInformation.mobilePhone, política paresStatus, returnUrl en el dominio de la app (cs-3ds-return se retiró: Supabase
// servía su HTML como text/plain). Todo simulado: ningún caso aquí cuenta como validado en Sandbox.
import { describe, it, expect } from 'vitest'
import mig186 from '../../../../../supabase/migrations/20270108120000_cs1a6_reversa_autorizacion.sql?raw'
import mig187 from '../../../../../supabase/migrations/20270109120000_cs1a7_cierre_manual.sql?raw'
import edge from '../../../../../supabase/functions/cs-3ds/index.ts?raw'
import {
  ORIGENES_DDC, RUTA_RETORNO_3DS, urlEsCardinal, buildSetupRequest, leerSetup, normalizarDispositivo, buildBillTo, partirNombre, buildEnrollRequest,
  leerEnroll, ventanaDesdePareq, VENTANAS_RETO, buildValidateRequest, leerValidate, datosAvance, ESTADOS_ACCION,
} from '../../../../../supabase/functions/cs-3ds/contrato'

const JTI = '1C66OQNAOU90VSAO5MCNQJS81OSHNKU814BWGOBTVKXI4LKS9F9767C1F9CE66ED'
const ATT = '11111111-1111-4111-8111-111111111111'
const DISP = { httpBrowserLanguage: 'es-MX', httpBrowserJavaEnabled: false, httpBrowserJavaScriptEnabled: true, httpBrowserColorDepth: '24', httpBrowserScreenHeight: '864', httpBrowserScreenWidth: '1536', httpBrowserTimeDifference: '360' }
const CAB = { accept: 'application/json', userAgent: 'Mozilla/5.0 (prueba)', ip: '187.190.1.2, 10.0.0.1' }
const ADDR = { line1: 'Av. Álvaro Obregón 1045', colonia: 'Centro', cp: '80000', city: 'Culiacán', state: 'Sinaloa', country: 'México', nombre: 'María José Pérez López', phone: '(667) 164-7799' }

describe('CS-1A.4 · setup', () => {
  // CS-BB: antes se mandaba tokenInformation.transientToken (el JWT completo); el manual §7.2 exige tokenInformation.jti.
  it('request del manual §7.2: solo code + tokenInformation.jti (nunca el JWT)', () => {
    expect(buildSetupRequest(ATT, JTI)).toEqual({ clientReferenceInformation: { code: ATT }, tokenInformation: { jti: JTI } })
    expect(() => buildSetupRequest(ATT, 'a.b.c')).toThrow('jti inválido')
    expect(() => buildSetupRequest(ATT, '')).toThrow('jti inválido')
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
  // CS-BB: deviceChannel pasa de 'Browser' a 'BROWSER' (manual §8), jti en vez de transientToken y se agrega buyerInformation.mobilePhone.
  it('request del manual §8: importe del servidor, MXN, jti, mobilePhone, BROWSER, returnUrl de la app, modo S y campos KA-04583', () => {
    const RET = 'https://portal.renovacell.mx/pago/3ds-retorno'
    const r = buildEnrollRequest({ attemptId: ATT, jti: JTI, amount: 6000, billTo: bt, referenceId: 'ref-1', returnUrl: RET, dispositivo: disp, movil: '+52 (667) 164-7799' })
    expect(r).toEqual({ clientReferenceInformation: { code: ATT }, orderInformation: { amountDetails: { currency: 'MXN', totalAmount: '6000.00' }, billTo: bt }, tokenInformation: { jti: JTI },
                        buyerInformation: { mobilePhone: 6671647799 }, deviceInformation: disp,
                        consumerAuthenticationInformation: { deviceChannel: 'BROWSER', returnUrl: RET, referenceId: 'ref-1', transactionMode: 'S' } })
    expect(RUTA_RETORNO_3DS).toBe('/pago/3ds-retorno')
    // sin teléfono del cliente: el del bill-to (10 dígitos)
    expect(buildEnrollRequest({ attemptId: ATT, jti: JTI, amount: 1, billTo: bt, referenceId: 'r', returnUrl: RET, dispositivo: disp }).buyerInformation).toEqual({ mobilePhone: 6671647799 })
    expect(() => buildEnrollRequest({ attemptId: ATT, jti: JTI, amount: 0, billTo: bt, referenceId: 'r', returnUrl: 'u', dispositivo: disp })).toThrow('importe')
    expect(() => buildEnrollRequest({ attemptId: ATT, jti: JTI, amount: 1, billTo: bt, referenceId: '', returnUrl: 'u', dispositivo: disp })).toThrow('referenceId')
    expect(() => buildEnrollRequest({ attemptId: ATT, jti: 'eyJ.x.y', amount: 1, billTo: bt, referenceId: 'r', returnUrl: 'u', dispositivo: disp })).toThrow('jti')
    expect(JSON.stringify(r)).not.toMatch(/\b4111\d{12}\b|cvv|securityCode/i)
  })
  it('lectura: frictionless, reto (stepUp de Cardinal + ventana del pareq), rechazada, no reconocida, reto incompleto, URL ajena', () => {
    const ci = { authenticationTransactionId: 'tx-1', eci: '05', eciRaw: '05', paresStatus: 'Y', veresEnrolled: 'Y', specificationVersion: '2.2.0', effectiveAuthenticationType: 'FR', challengeRequired: 'N' }
    const fr = leerEnroll({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: ci })
    expect(fr).toMatchObject({ ok: true, resultado: 'autenticada', evidencia: { authenticationTransactionId: 'tx-1', eci: '05', paresStatus: 'Y', veresEnrolled: 'Y', effectiveAuthenticationType: 'FR' } })
    const pareq = btoa(JSON.stringify({ messageType: 'CReq', challengeWindowSize: '03' })).replace(/=+$/, '')
    const reto = leerEnroll({ status: 'PENDING_AUTHENTICATION', consumerAuthenticationInformation: { ...ci, paresStatus: 'C', challengeRequired: 'Y', stepUpUrl: 'https://centinelapistag.cardinalcommerce.com/V2/Cruise/StepUp', accessToken: 'jwt.stepup', pareq } })
    expect(reto).toMatchObject({ ok: true, resultado: 'reto', stepUpUrl: 'https://centinelapistag.cardinalcommerce.com/V2/Cruise/StepUp', accessToken: 'jwt.stepup', ventana: '03' })
    expect(ventanaDesdePareq('no-base64!!')).toBe('02'); expect(ventanaDesdePareq(btoa('{"challengeWindowSize":"09"}'))).toBe('02'); expect(VENTANAS_RETO['05']).toBeNull(); expect(VENTANAS_RETO['02']).toEqual({ w: 390, h: 400 })
    // CS-BB: el motivo ya no es el texto del proveedor (no se muestra al doctor); queda el paresStatus/status para auditoría
    expect(leerEnroll({ status: 'AUTHENTICATION_FAILED', message: 'Authentication failed', consumerAuthenticationInformation: { ...ci, paresStatus: 'N' } })).toMatchObject({ ok: true, resultado: 'rechazada', motivo: 'paresStatus=N status=AUTHENTICATION_FAILED veresEnrolled=Y' })
    expect(leerEnroll({ status: 'INVALID_REQUEST' })).toMatchObject({ ok: false, motivo: 'forma_no_reconocida' })
    expect(leerEnroll({ status: 'PENDING_AUTHENTICATION', consumerAuthenticationInformation: { authenticationTransactionId: 'tx' } })).toMatchObject({ ok: false, motivo: 'reto_incompleto' })
    expect(leerEnroll({ status: 'PENDING_AUTHENTICATION', consumerAuthenticationInformation: { ...ci, paresStatus: 'C', stepUpUrl: 'https://evil.example/stepup', accessToken: 'x' } })).toMatchObject({ ok: false, motivo: 'url_no_cardinal' })
  })
  // CS-BB: antes una tarjeta no inscrita (SUCCESSFUL con paresStatus U) se daba por autenticada siguiendo el `status`. La política del
  // dueño decide por paresStatus: U (y N, R o cualquier otro) se rechaza SIN cobrar; la evidencia queda escrita en el intento.
  it('tarjeta no inscrita / no disponible (paresStatus U) se rechaza aunque status diga SUCCESSFUL; la evidencia no lleva cavv/xid/tokens', () => {
    const r = leerEnroll({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { authenticationTransactionId: 'tx-2', veresEnrolled: 'U', paresStatus: 'U', cavv: 'AAABBIcJIoQDIzAgVAkiAAAAAAA=' } })
    expect(r).toMatchObject({ ok: true, resultado: 'rechazada', evidencia: { veresEnrolled: 'U', paresStatus: 'U', eci: null } })
    if (!r.ok) throw new Error('lectura inesperada')
    const d = datosAvance(r.evidencia, 'AUTHENTICATION_FAILED')
    expect(d).toMatchObject({ cs_auth_transaction_id: 'tx-2', cs_auth_status: 'AUTHENTICATION_FAILED', detalle_3ds: { veresEnrolled: 'U', paresStatus: 'U' } })
    expect(JSON.stringify(d)).not.toMatch(/cavv|xid|ucaf|accessToken|transientToken|pareq|AAABB/)
  })
})

describe('CS-1A.4 · validación', () => {
  // CS-BB: el manual §10.2 sustituye los campos de tarjeta por el token transitorio → tokenInformation.jti (antes no se mandaba nada).
  it('request del manual §10.2: code + authenticationTransactionId del servidor + importe + jti; sin tarjeta', () => {
    expect(buildValidateRequest(ATT, 'tx-1', 6000, JTI)).toEqual({ clientReferenceInformation: { code: ATT }, consumerAuthenticationInformation: { authenticationTransactionId: 'tx-1' }, orderInformation: { amountDetails: { currency: 'MXN', totalAmount: '6000.00' } }, tokenInformation: { jti: JTI } })
    expect(() => buildValidateRequest(ATT, '', 1, JTI)).toThrow('authenticationTransactionId')
    expect(() => buildValidateRequest(ATT, 'tx', 1, '')).toThrow('jti')
  })
  it('lectura: autenticada, rechazada, pendiente (reto sin terminar), no reconocida', () => {
    expect(leerValidate({ status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { eci: '05', paresStatus: 'Y' } })).toMatchObject({ ok: true, resultado: 'autenticada', evidencia: { eci: '05' } })
    expect(leerValidate({ status: 'AUTHENTICATION_FAILED', message: 'no' })).toMatchObject({ ok: true, resultado: 'rechazada', motivo: 'paresStatus=ninguno status=AUTHENTICATION_FAILED' })
    expect(leerValidate({ status: 'PENDING_AUTHENTICATION' })).toMatchObject({ ok: true, resultado: 'pendiente' })
    expect(leerValidate({})).toMatchObject({ ok: false, motivo: 'forma_no_reconocida' })
  })
  it('estados por acción (la página de retorno se mudó a Netlify: ver csBanbajio.test.ts)', () => {
    expect(ESTADOS_ACCION).toEqual({ setup: ['created', 'tokenized'], enroll: ['auth_setup'], validate: ['auth_challenge'], abandonar: ['created', 'tokenized', 'auth_setup', 'auth_pending', 'auth_challenge'] })
  })
  it('CS-DEPLOY-03B-FIX · abandonar NUNCA libera una reserva ya enviada al banco: solo estados previos al envío, comprobados antes de avanzar', () => {
    const posteriores = ['auth_validated', 'authz_sent', 'authorized', 'captured', 'posted', 'unknown_requires_reconciliation', 'declined', 'amount_changed', 'expired', 'failed_safe_to_retry', 'closed']
    for (const e of posteriores) expect(ESTADOS_ACCION.abandonar, e).not.toContain(e)
    const src = edge.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    const iCheck = src.indexOf("if (!estadoValido('abandonar')) return json(409"), iAvz = src.indexOf("avanzar('failed_safe_to_retry', { error: 'abandonado por el cliente antes de enviar al banco' })")
    expect(iCheck).toBeGreaterThan(0); expect(iAvz).toBeGreaterThan(iCheck)
    // la máquina de estados de la base (184, 186 y 187) tampoco admite failed_safe_to_retry desde ningún estado posterior al envío
    for (const fila of ['authz_sent', 'authorized', 'captured']) {
      const linea = mig186.split('\n').find((l) => l.includes(`when p_de = '${fila}'`))
      expect(linea, fila).toBeTruthy(); expect(linea).not.toContain('failed_safe_to_retry')
    }
    expect(mig187).toMatch(/v_a\.status = 'unknown_requires_reconciliation' and p_estado = 'failed_safe_to_retry' then\n\s*raise exception 'CIERRE_MANUAL_REQUERIDO/)
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
  it('cs-3ds: jti del token con firma verificada en setup/enroll; jti guardado en validate; nunca el JWT hacia CyberSource', () => {
    expect(src).toMatch(/verificarTokenTransitorio\(token, obtenedorJwkCS\(cfg\)\)/)
    expect(src).toMatch(/buildSetupRequest\(attemptId, t\.jti\)/)
    expect(src).toMatch(/jti: lt\.t\.jti/)
    expect(src).toMatch(/buildValidateRequest\(attemptId, intento\.cs_auth_transaction_id, amount, previa\.jti\)/)
    expect(src).not.toMatch(/transientToken|buildSetupRequest\(attemptId, token\)/)
    // un token distinto del autenticado obliga a un 3DS nuevo
    expect(src).toMatch(/decidirReentrada\(/); expect(src).toMatch(/previa\.jti !== lt\.t\.jti\) return await reautenticar/)
    expect(src).toMatch(/txNavegador !== intento\.cs_auth_transaction_id/)
  })
})

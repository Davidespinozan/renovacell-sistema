// CS-1A.5 · contratos puros de autorización/captura (request oficial con token transitorio + validación 3DS, lectura de status,
// captura separada, evidencia persistida, mensajes) + guardas de fuente de la Edge `cs-pago`. Todo simulado (no validado en Sandbox).
import { describe, it, expect } from 'vitest'
import edge from '../../../../../supabase/functions/cs-pago/index.ts?raw'
import {
  modoCaptura, MODO_CAPTURA_POR_DEFECTO, buildPaymentRequest, leerPago, evidenciaPago, buildCaptureRequest, leerCaptura, datosAutorizacion, datosCaptura,
  MENSAJES_ESTADO, ESTADO_PAGABLE, ESTADOS_EN_CURSO,
} from '../../../../../supabase/functions/cs-pago/contrato'

const JTI = '1C66OQNAOU90VSAO5MCNQJS81OSHNKU814BWGOBTVKXI4LKS9F9767C1F9CE66ED'
const ATT = '11111111-1111-4111-8111-111111111111'
const BT = { firstName: 'Maria Jose', lastName: 'Perez Lopez', address1: 'Av. Obregon 1045', locality: 'Culiacan', administrativeArea: 'Sinaloa', postalCode: '80000', country: 'MX', email: 'm@c.mx', phoneNumber: '6671647799' }

// CS-BB: el request cambió al del manual de BanBajío §11–13. Antes: actionList VALIDATE_CONSUMER_AUTHENTICATION + transientTokenJwt +
// solo authenticationTransactionId, y autorización/captura separadas por omisión. Ahora: venta (capture:true), jti, valores 3DS
// explícitos por marca y commerceIndicator (casos por marca en csBanbajio.test.ts).
describe('CS-1A.5 · request de autorización (manual BanBajío)', () => {
  const AUTH = { jti: JTI, token_exp: '2026-11-21T12:15:00Z', card_brand: 'visa', authentication_transaction_id: 'tx-1', pares_status: 'Y', eci: '05', eci_raw: '05', cavv: 'AAABBIcJIoQDIzAgVAkiAAAAAAA=', xid: 'WElEMTIzNA==', ucaf_collection_indicator: null, ucaf_authentication_data: null, directory_server_transaction_id: 'ds-1', specification_version: '2.2.0', ecommerce_indicator: 'vbv' }
  it('venta: code, capture, commerceIndicator, importe del intento, billTo, valores 3DS y jti; sin actionList ni transientTokenJwt', () => {
    const r = buildPaymentRequest({ attemptId: ATT, amount: 6000, jti: JTI, auth: AUTH, marca: 'visa', commerceIndicator: 'vbv', billTo: BT, modo: 'venta' })
    expect(r).toEqual({ clientReferenceInformation: { code: ATT }, processingInformation: { capture: true, commerceIndicator: 'vbv' },
                        orderInformation: { amountDetails: { totalAmount: '6000.00', currency: 'MXN' }, billTo: BT },
                        consumerAuthenticationInformation: { authenticationTransactionId: 'tx-1', cavv: AUTH.cavv, eciRaw: '05', xid: AUTH.xid, directoryServerTransactionId: 'ds-1', paresStatus: 'Y', strongAuthentication: { transactionMode: 'S' } },
                        tokenInformation: { jti: JTI } })
    expect(JSON.stringify(r)).not.toMatch(/actionList|VALIDATE_CONSUMER_AUTHENTICATION|transientToken|securityCode|"number"/)
    expect(buildPaymentRequest({ attemptId: ATT, amount: 6000, jti: JTI, auth: AUTH, marca: 'visa', commerceIndicator: 'vbv', billTo: BT, modo: 'auth_captura' }).processingInformation.capture).toBe(false)
    expect(() => buildPaymentRequest({ attemptId: ATT, amount: 0, jti: JTI, auth: AUTH, marca: 'visa', commerceIndicator: 'vbv', billTo: BT, modo: 'venta' })).toThrow('importe')
    expect(() => buildPaymentRequest({ attemptId: ATT, amount: 1, jti: 'x.y.z', auth: AUTH, marca: 'visa', commerceIndicator: 'vbv', billTo: BT, modo: 'venta' })).toThrow('jti')
    expect(() => buildPaymentRequest({ attemptId: ATT, amount: 1, jti: JTI, auth: { ...AUTH, authentication_transaction_id: null }, marca: 'visa', commerceIndicator: 'vbv', billTo: BT, modo: 'venta' })).toThrow('authenticationTransactionId')
    expect(() => buildPaymentRequest({ attemptId: ATT, amount: 1, jti: JTI, auth: AUTH, marca: 'visa', commerceIndicator: '', billTo: BT, modo: 'venta' })).toThrow('commerceIndicator')
  })
  it('modo de captura: venta por omisión (manual §11–13); auth_captura solo si se configura explícito', () => {
    expect(MODO_CAPTURA_POR_DEFECTO).toBe('venta'); expect(modoCaptura(undefined)).toBe('venta'); expect(modoCaptura('  AUTH_CAPTURA ')).toBe('auth_captura'); expect(modoCaptura('sale')).toBe('venta')
  })
})

describe('CS-1A.5 · lectura de resultados', () => {
  it('AUTHORIZED con id = autorizada; sin id = incierta', () => {
    const ok = { id: '7000000000000000001', status: 'AUTHORIZED', reconciliationId: 'rec-1', processorInformation: { approvalCode: '831000', responseCode: '00' }, consumerAuthenticationInformation: { eci: '05' } }
    expect(leerPago(ok)).toEqual({ resultado: 'autorizada', evidencia: { id: '7000000000000000001', status: 'AUTHORIZED', reconciliationId: 'rec-1', approvalCode: '831000', responseCode: '00', reason: null, message: null, eci: '05', processorTransactionId: null } })
    expect(evidenciaPago({ ...ok, processorInformation: { ...ok.processorInformation, transactionId: '016153570198200' } }).processorTransactionId).toBe('016153570198200')
    expect(leerPago({ status: 'AUTHORIZED' })).toMatchObject({ resultado: 'incierta' })
  })
  it('DECLINED / AUTHORIZED_RISK_DECLINED / INVALID_REQUEST = rechazada (sin cargo); parciales y pendientes = incierta; otro = no reconocida', () => {
    expect(leerPago({ id: 'x', status: 'DECLINED', errorInformation: { reason: 'INSUFFICIENT_FUND', message: 'Decline - Insufficient funds in the account.' } })).toMatchObject({ resultado: 'rechazada', motivo: 'DECLINED · INSUFFICIENT_FUND · Decline - Insufficient funds in the account.' })
    expect(leerPago({ id: 'x', status: 'AUTHORIZED_RISK_DECLINED' })).toMatchObject({ resultado: 'rechazada' })
    expect(leerPago({ status: 'INVALID_REQUEST', errorInformation: { reason: 'DUPLICATE_REQUEST' } })).toMatchObject({ resultado: 'rechazada', motivo: 'INVALID_REQUEST · DUPLICATE_REQUEST' })
    for (const st of ['PARTIAL_AUTHORIZED', 'AUTHORIZED_PENDING_REVIEW', 'PENDING_REVIEW', 'PENDING_AUTHENTICATION']) expect(leerPago({ id: 'x', status: st })).toMatchObject({ resultado: 'incierta' })
    expect(leerPago({ id: 'x', status: 'CAPTURED' })).toMatchObject({ resultado: 'forma_no_reconocida' })
    expect(leerPago('<html>')).toMatchObject({ resultado: 'forma_no_reconocida' })
    expect(evidenciaPago(null)).toEqual({ id: null, status: null, reconciliationId: null, approvalCode: null, responseCode: null, reason: null, message: null, eci: null, processorTransactionId: null })
  })
  it('captura: request oficial y lectura (PENDING/TRANSMITTED con id = capturada)', () => {
    expect(buildCaptureRequest(ATT, 6000)).toEqual({ clientReferenceInformation: { code: ATT }, orderInformation: { amountDetails: { totalAmount: '6000.00', currency: 'MXN' } } })
    expect(() => buildCaptureRequest(ATT, -1)).toThrow('importe')
    expect(leerCaptura({ id: 'cap-1', status: 'PENDING', reconciliationId: 'rec-2' })).toEqual({ resultado: 'capturada', id: 'cap-1', status: 'PENDING', reconciliationId: 'rec-2' })
    expect(leerCaptura({ id: 'cap-1', status: 'TRANSMITTED' })).toMatchObject({ resultado: 'capturada' })
    expect(leerCaptura({ status: 'PENDING' })).toMatchObject({ resultado: 'forma_no_reconocida' })
    expect(leerCaptura({ id: 'cap-1', status: 'DECLINED' })).toMatchObject({ resultado: 'forma_no_reconocida' })
  })
  it('evidencia persistida: id/status/reconciliación/aprobación; sin token; la captura queda escrita en el intento', () => {
    const ev = evidenciaPago({ id: 'p-1', status: 'AUTHORIZED', reconciliationId: 'r', processorInformation: { approvalCode: 'A1', responseCode: '00' } })
    expect(datosAutorizacion(ev, false)).toEqual({ cs_payment_id: 'p-1', cs_payment_status: 'AUTHORIZED', cs_reconciliation_id: 'r', cs_approval_code: 'A1', cs_reason: '00', cs_eci: undefined })
    expect(datosAutorizacion(ev, true).cs_payment_status).toBe('AUTHORIZED+CAPTURE')
    expect(datosCaptura({ id: 'cap-1', status: 'PENDING', reconciliationId: null })).toEqual({ cs_payment_status: 'CAPTURE_PENDING', cs_reconciliation_id: undefined, cs_reason: 'capture:cap-1' })
    expect(MENSAJES_ESTADO.posted).toBe('Pago confirmado y registrado.'); expect(MENSAJES_ESTADO.authorized).toContain('No se realizará otro cargo'); expect(MENSAJES_ESTADO.unknown_requires_reconciliation).toContain('No vuelvas a intentar')
    expect(ESTADO_PAGABLE).toBe('auth_validated'); expect(ESTADOS_EN_CURSO).toEqual(['authz_sent', 'authorized', 'captured', 'unknown_requires_reconciliation', 'posted'])
  })
})

describe('CS-1A.5 · guardas de fuente de la Edge cs-pago', () => {
  const src = edge.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  it('autentica, exige dueño verificado, lee el intento con el JWT del llamante, solo paga desde auth_validated y marca authz_sent ANTES de llamar al banco', () => {
    expect(src).toMatch(/resolverQuien\(caller, admin\)/); expect(src).toMatch(/q\.quien\.role === 'doctor' && q\.quien\.verified/)
    expect(src).toMatch(/caller\.from\('card_payment_attempts'\)/); expect(src).toMatch(/intento\.doctor_id !== q\.quien\.uid/)
    expect(src).toMatch(/intento\.status !== ESTADO_PAGABLE/)
    const iSent = src.indexOf("avanzar('authz_sent')"), iPay = src.indexOf('RUTAS_CS.pagos, cuerpo')
    // CS-BB: el token se verifica y su jti debe ser el autenticado ANTES de marcar el envío
    const iJti = src.indexOf('auth.jti !== lt.token.jti'); expect(iJti).toBeGreaterThan(0); expect(iJti).toBeLessThan(iSent)
    expect(iSent).toBeGreaterThan(0); expect(iPay).toBeGreaterThan(iSent)
    expect(src).toMatch(/envio\.status === 'already'\) return json\(409, \{ error: 'en_proceso'/)
    expect(src).toMatch(/envio\.status === 'amount_changed'\) return json\(409, \{ error: 'importe_cambio'/)
  })
  it('importe/moneda/referencia del intento (nunca del navegador); token solo al banco; una llamada; sin reintentos; desconocidos conservan la reserva', () => {
    expect(src).not.toMatch(/p\.(amount|importe|monto|currency|reference|cs_payment_id|authenticationTransactionId|capture|modo)/)
    expect(src).toMatch(/const amount = Number\(intento\.amount\)/)
    expect(src).not.toMatch(/p_datos: \{[^}]*token/); expect(src).not.toMatch(/console\.(log|warn|error)/); expect(src.replace(/failed_safe_to_retry/g, '')).not.toMatch(/reintent|retry|for \(let i/i)
    expect(src).toMatch(/avanzar\('unknown_requires_reconciliation'/)
    // CS-BB: 'failed_safe_to_retry' ahora existe en cs-pago, pero SOLO antes de authz_sent (token caducado o de otra tarjeta: no hubo
    // envío al banco). Tras enviar al banco sigue sin haber "fallo seguro" ni expiración.
    expect(src).not.toMatch(/'expired'/)
    const iFallo = src.lastIndexOf("'failed_safe_to_retry'"), iEnvio = src.indexOf("avanzar('authz_sent')")
    expect(iFallo).toBeGreaterThan(0); expect(iFallo).toBeLessThan(iEnvio)
    expect((src.match(/RUTAS_CS\.pagos, cuerpo/g) ?? []).length).toBe(1)
  })
  it('contabiliza solo vía cs_intento_contabilizar; nunca escribe payment_entries ni registrar_cobro; authorized sin captura no se contabiliza', () => {
    expect(src).toMatch(/admin\.rpc\('cs_intento_contabilizar'/)
    expect(src).not.toMatch(/payment_entries|registrar_cobro|_w2_asiento|payOrder|reportar_pago/)
    expect(src).toMatch(/return respuestaEstado\('authorized'/)
    expect(src).toMatch(/if \(intento\.status === 'captured'\) \{ const c = await contabilizar\(\)/)
    expect(src).not.toMatch(/sharedSecret|keyId|firma\.headers|Signature/)
  })
})

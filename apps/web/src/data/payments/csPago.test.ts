// CS-1A.5 · contratos puros de autorización/captura (request oficial con token transitorio + validación 3DS, lectura de status,
// captura separada, evidencia persistida, mensajes) + guardas de fuente de la Edge `cs-pago`. Todo simulado (no validado en Sandbox).
import { describe, it, expect } from 'vitest'
import edge from '../../../../../supabase/functions/cs-pago/index.ts?raw'
import {
  modoCaptura, MODO_CAPTURA_POR_DEFECTO, buildPaymentRequest, leerPago, evidenciaPago, buildCaptureRequest, leerCaptura, datosAutorizacion, datosCaptura,
  MENSAJES_ESTADO, ESTADO_PAGABLE, ESTADOS_EN_CURSO,
} from '../../../../../supabase/functions/cs-pago/contrato'

const TOKEN = 'eyJraWQiOiIwOCJ9.eyJqdGkiOiJ0cmFuc2llbnRlIn0.firma'
const ATT = '11111111-1111-4111-8111-111111111111'
const BT = { firstName: 'Maria Jose', lastName: 'Perez Lopez', address1: 'Av. Obregon 1045', locality: 'Culiacan', administrativeArea: 'Sinaloa', postalCode: '80000', country: 'MX', email: 'm@c.mx', phoneNumber: '6671647799' }

describe('CS-1A.5 · request de autorización', () => {
  it('contrato oficial: code, VALIDATE_CONSUMER_AUTHENTICATION, authenticationTransactionId del servidor, importe del intento, transientTokenJwt; capture según modo', () => {
    const r = buildPaymentRequest({ attemptId: ATT, amount: 6000, token: TOKEN, authenticationTransactionId: 'tx-1', billTo: BT, modo: 'auth_captura' })
    expect(r).toEqual({ clientReferenceInformation: { code: ATT }, processingInformation: { capture: false, actionList: ['VALIDATE_CONSUMER_AUTHENTICATION'] },
                        consumerAuthenticationInformation: { authenticationTransactionId: 'tx-1' }, orderInformation: { amountDetails: { totalAmount: '6000.00', currency: 'MXN' }, billTo: BT }, tokenInformation: { transientTokenJwt: TOKEN } })
    expect(buildPaymentRequest({ attemptId: ATT, amount: 6000, token: TOKEN, authenticationTransactionId: 'tx-1', billTo: BT, modo: 'venta' }).processingInformation.capture).toBe(true)
    expect(() => buildPaymentRequest({ attemptId: ATT, amount: 0, token: TOKEN, authenticationTransactionId: 'tx-1', billTo: BT, modo: 'venta' })).toThrow('importe')
    expect(() => buildPaymentRequest({ attemptId: ATT, amount: 1, token: 'x', authenticationTransactionId: 'tx-1', billTo: BT, modo: 'venta' })).toThrow('token')
    expect(() => buildPaymentRequest({ attemptId: ATT, amount: 1, token: TOKEN, authenticationTransactionId: '', billTo: BT, modo: 'venta' })).toThrow('authenticationTransactionId')
    expect(JSON.stringify(r)).not.toMatch(/cavv|xid|securityCode|number"/)
  })
  it('modo de captura explícito: auth_captura por defecto; venta solo si se configura', () => {
    expect(MODO_CAPTURA_POR_DEFECTO).toBe('auth_captura'); expect(modoCaptura(undefined)).toBe('auth_captura'); expect(modoCaptura('  VENTA ')).toBe('venta'); expect(modoCaptura('sale')).toBe('auth_captura')
  })
})

describe('CS-1A.5 · lectura de resultados', () => {
  it('AUTHORIZED con id = autorizada; sin id = incierta', () => {
    const ok = { id: '7000000000000000001', status: 'AUTHORIZED', reconciliationId: 'rec-1', processorInformation: { approvalCode: '831000', responseCode: '00' }, consumerAuthenticationInformation: { eci: '05' } }
    expect(leerPago(ok)).toEqual({ resultado: 'autorizada', evidencia: { id: '7000000000000000001', status: 'AUTHORIZED', reconciliationId: 'rec-1', approvalCode: '831000', responseCode: '00', reason: null, message: null, eci: '05' } })
    expect(leerPago({ status: 'AUTHORIZED' })).toMatchObject({ resultado: 'incierta' })
  })
  it('DECLINED / AUTHORIZED_RISK_DECLINED / INVALID_REQUEST = rechazada (sin cargo); parciales y pendientes = incierta; otro = no reconocida', () => {
    expect(leerPago({ id: 'x', status: 'DECLINED', errorInformation: { reason: 'INSUFFICIENT_FUND', message: 'Decline - Insufficient funds in the account.' } })).toMatchObject({ resultado: 'rechazada', motivo: 'DECLINED · INSUFFICIENT_FUND · Decline - Insufficient funds in the account.' })
    expect(leerPago({ id: 'x', status: 'AUTHORIZED_RISK_DECLINED' })).toMatchObject({ resultado: 'rechazada' })
    expect(leerPago({ status: 'INVALID_REQUEST', errorInformation: { reason: 'DUPLICATE_REQUEST' } })).toMatchObject({ resultado: 'rechazada', motivo: 'INVALID_REQUEST · DUPLICATE_REQUEST' })
    for (const st of ['PARTIAL_AUTHORIZED', 'AUTHORIZED_PENDING_REVIEW', 'PENDING_REVIEW', 'PENDING_AUTHENTICATION']) expect(leerPago({ id: 'x', status: st })).toMatchObject({ resultado: 'incierta' })
    expect(leerPago({ id: 'x', status: 'CAPTURED' })).toMatchObject({ resultado: 'forma_no_reconocida' })
    expect(leerPago('<html>')).toMatchObject({ resultado: 'forma_no_reconocida' })
    expect(evidenciaPago(null)).toEqual({ id: null, status: null, reconciliationId: null, approvalCode: null, responseCode: null, reason: null, message: null, eci: null })
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
    expect(iSent).toBeGreaterThan(0); expect(iPay).toBeGreaterThan(iSent)
    expect(src).toMatch(/envio\.status === 'already'\) return json\(409, \{ error: 'en_proceso'/)
    expect(src).toMatch(/envio\.status === 'amount_changed'\) return json\(409, \{ error: 'importe_cambio'/)
  })
  it('importe/moneda/referencia del intento (nunca del navegador); token solo al banco; una llamada; sin reintentos; desconocidos conservan la reserva', () => {
    expect(src).not.toMatch(/p\.(amount|importe|monto|currency|reference|cs_payment_id|authenticationTransactionId|capture|modo)/)
    expect(src).toMatch(/const amount = Number\(intento\.amount\)/)
    expect(src).not.toMatch(/p_datos: \{[^}]*token/); expect(src).not.toMatch(/console\.(log|warn|error)/); expect(src).not.toMatch(/reintent|retry|for \(let i/i)
    expect(src).toMatch(/avanzar\('unknown_requires_reconciliation'/)
    expect(src).not.toMatch(/'failed_safe_to_retry'|'expired'/)   // tras enviar al banco no hay "fallo seguro" ni expiración
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

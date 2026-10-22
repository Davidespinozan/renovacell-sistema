// CS-1A.6 · contratos puros de conciliación (lectura de transacción/búsqueda, resumen de hallazgos, resolución derivada, reversa,
// evidencia) + guardas de fuente de la Edge `cs-conciliar`. Todo simulado (no validado en Sandbox).
import { describe, it, expect } from 'vitest'
import edge from '../../../../../supabase/functions/cs-conciliar/index.ts?raw'
import { RUTAS_CS } from '../../../../../supabase/functions/_shared/cybersource'
import {
  leerTransaccion, leerBusqueda, buildBusqueda, resumirHallazgo, decidirResolucion, buildReversalRequest, leerReversa, ESTADOS_CONCILIACION, textoEvidencia, type Hallazgo,
  SIN_TRANSACCIONES, HORAS_MINIMAS_CIERRE, MOTIVO_MINIMO_CIERRE, MINUTOS_ENVIO_EN_VUELO, horasParaCierre, buildConsultaCierre,
} from '../../../../../supabase/functions/cs-conciliar/contrato'
import contrato from '../../../../../supabase/functions/cs-conciliar/contrato.ts?raw'

const ATT = '11111111-1111-4111-8111-111111111111'
const tx = (id: string, apps: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({ id, clientReferenceInformation: { code: ATT }, orderInformation: { amountDetails: { totalAmount: '6000.00', currency: 'MXN' } }, applicationInformation: { applications: apps }, submitTimeUtc: '2026-10-20T15:00:00Z', ...extra })
const auth = (ok = true) => ({ name: 'ics_auth', rCode: ok ? '1' : '0', rFlag: ok ? 'SOK' : 'DDECLINE', reasonCode: ok ? '100' : '203', status: 'AUTHORIZED' })
const bill = (status = 'PENDING', ok = true) => ({ name: 'ics_bill', rCode: ok ? '1' : '0', rFlag: ok ? 'SOK' : 'DINVALIDDATA', reasonCode: ok ? '100' : '102', status, reconciliationId: 'rec-9' })

describe('CS-1A.6 · lectura de transacciones', () => {
  it('detalle: id, referencia, importe y aplicaciones clasificadas por rCode/rFlag', () => {
    const t = leerTransaccion(tx('p-1', [auth(), bill('TRANSMITTED')]))
    expect(t).toMatchObject({ id: 'p-1', referencia: ATT, importe: 6000, moneda: 'MXN', apps: [{ nombre: 'ics_auth', estado: 'aprobada', reasonCode: '100' }, { nombre: 'ics_bill', estado: 'aprobada', status: 'TRANSMITTED', reconciliationId: 'rec-9' }] })
    expect(leerTransaccion(tx('p-2', [auth(false)])).apps[0].estado).toBe('rechazada')
    expect(leerTransaccion(tx('p-3', [{ name: 'ics_bill', rCode: '-1', rFlag: 'ESYSTEM' }])).apps[0].estado).toBe('error')
    expect(leerTransaccion(tx('p-4', [{ name: 'ics_auth' }])).apps[0].estado).toBe('desconocido')
    expect(leerTransaccion('x')).toMatchObject({ id: null, apps: [] })
  })
  it('búsqueda: request oficial por referencia y lectura de transactionSummaries', () => {
    expect(buildBusqueda(ATT)).toEqual({ query: `clientReferenceInformation.code:${ATT}`, limit: 50, sort: 'submitTimeUtc:desc', timezone: 'UTC' })
    expect(() => buildBusqueda('x" or 1=1')).toThrow('referencia')
    const l = leerBusqueda({ totalCount: 2, _embedded: { transactionSummaries: [tx('p-1', [auth()]), tx('p-2', [bill()])] } })
    expect(l.map((t) => t.id)).toEqual(['p-1', 'p-2']); expect(leerBusqueda({})).toEqual([])
    expect(RUTAS_CS.busqueda).toBe('/tss/v2/searches')
  })
})

describe('CS-1A.6 · hallazgo y resolución derivada', () => {
  it('captura aceptada (PENDING o TRANSMITTED) → captured con id de la autorización; ignora transacciones de otra referencia', () => {
    const h = resumirHallazgo([leerTransaccion(tx('p-1', [auth(), bill('PENDING')])), leerTransaccion(tx('p-9', [auth()], { clientReferenceInformation: { code: 'otro' } }))], ATT, 6000)
    expect(h).toMatchObject({ autorizacion: { estado: 'aprobada', id: 'p-1' }, captura: { estado: 'aprobada', id: 'p-1', status: 'PENDING' }, importe_coincide: true, referencia_coincide: true, transacciones: 2 })
    expect(decidirResolucion(h, 'unknown_requires_reconciliation')).toEqual({ accion: 'captured', cs_payment_id: 'p-1', cs_payment_status: 'CAPTURE_PENDING', cs_reconciliation_id: 'rec-9', motivo: 'captura aceptada por el proveedor (ics_bill aprobada)' })
  })
  it('autorización aprobada sin captura → authorized (o sin cambio si ya lo está); captura rechazada → authorized; rechazada → declined', () => {
    const hA = resumirHallazgo([leerTransaccion(tx('p-1', [auth()]))], ATT, 6000)
    expect(decidirResolucion(hA, 'unknown_requires_reconciliation')).toMatchObject({ accion: 'authorized', cs_payment_id: 'p-1' })
    expect(decidirResolucion(hA, 'authorized')).toMatchObject({ accion: 'sin_cambio' })
    const hB = resumirHallazgo([leerTransaccion(tx('p-1', [auth(), bill('PENDING', false)]))], ATT, 6000)
    expect(decidirResolucion(hB, 'unknown_requires_reconciliation')).toMatchObject({ accion: 'authorized', motivo: expect.stringContaining('captura rechazada') })
    const hC = resumirHallazgo([leerTransaccion(tx('p-1', [auth(false)]))], ATT, 6000)
    expect(decidirResolucion(hC, 'authz_sent')).toMatchObject({ accion: 'declined', cs_payment_id: 'p-1' })
  })
  it('reversa aprobada o anulación aprobada → declined; captura duplicada (dos ics_bill) sigue siendo UNA captura (la mejor)', () => {
    const hR = resumirHallazgo([leerTransaccion(tx('p-1', [auth(), { name: 'ics_auth_reversal', rCode: '1', rFlag: 'SOK' }]))], ATT, 6000)
    expect(decidirResolucion(hR, 'authorized')).toMatchObject({ accion: 'declined', motivo: expect.stringContaining('reversada') })
    const hV = resumirHallazgo([leerTransaccion(tx('p-1', [auth(), bill(), { name: 'ics_void', rCode: '1', rFlag: 'SOK' }]))], ATT, 6000)
    expect(decidirResolucion(hV, 'captured')).toMatchObject({ accion: 'declined', motivo: expect.stringContaining('anulada') })
    const hD = resumirHallazgo([leerTransaccion(tx('p-1', [auth(), bill('PENDING')])), leerTransaccion(tx('c-2', [bill('TRANSMITTED')]))], ATT, 6000)
    expect(hD.captura).toMatchObject({ estado: 'aprobada' }); expect(decidirResolucion(hD, 'unknown_requires_reconciliation').accion).toBe('captured')
  })
  it('CS-1A.7 · sin transacciones NUNCA deriva fallo seguro (ni por tiempo): sin cambio y reserva conservada; importe distinto o referencia ajena → sin cambio', () => {
    const h0 = resumirHallazgo([], ATT, 6000)
    expect(decidirResolucion(h0, 'unknown_requires_reconciliation')).toEqual({ accion: 'sin_cambio', motivo: SIN_TRANSACCIONES })
    expect(decidirResolucion(h0, 'authz_sent')).toEqual({ accion: 'sin_cambio', motivo: SIN_TRANSACCIONES })
    expect(SIN_TRANSACCIONES).toMatch(/no demuestra/); expect(SIN_TRANSACCIONES).toMatch(/cierre manual/)
    // la regla insegura no existe en el contrato: ninguna resolución produce failed_safe_to_retry y no hay umbral de minutos
    expect(contrato).not.toMatch(/failed_safe_to_retry/); expect(contrato).not.toMatch(/minutosDesdeEnvio|>= 30|30 min/)
    expect(decidirResolucion.length).toBe(2)
    const hI = resumirHallazgo([leerTransaccion(tx('p-1', [auth(), bill()], { orderInformation: { amountDetails: { totalAmount: '5999.00' } } }))], ATT, 6000)
    expect(decidirResolucion(hI, 'unknown_requires_reconciliation')).toMatchObject({ accion: 'sin_cambio', motivo: expect.stringContaining('importe') })
    const hX = resumirHallazgo([leerTransaccion(tx('p-1', [auth(), bill()], { clientReferenceInformation: { code: 'otra-ref' } }))], ATT, 6000)
    expect(hX.referencia_coincide).toBe(false); expect(decidirResolucion(hX, 'unknown_requires_reconciliation')).toMatchObject({ accion: 'sin_cambio' })
    const hAmb = resumirHallazgo([leerTransaccion(tx('p-1', [{ name: 'ics_auth' }]))], ATT, 6000)
    expect(decidirResolucion(hAmb, 'unknown_requires_reconciliation')).toMatchObject({ accion: 'sin_cambio', motivo: expect.stringContaining('ambiguo') })
  })
  it('reversa: request oficial (importe del intento, motivo saneado) y lectura REVERSED; evidencia sin datos sensibles', () => {
    expect(buildReversalRequest(ATT, 6000, 'cliente canceló <script> ñ')).toEqual({ clientReferenceInformation: { code: ATT }, reversalInformation: { amountDetails: { totalAmount: '6000.00' }, reason: 'cliente cancel script ' } })
    expect(() => buildReversalRequest(ATT, 0, 'x')).toThrow('importe')
    expect(leerReversa({ id: 'r-1', status: 'REVERSED' })).toEqual({ ok: true, id: 'r-1', status: 'REVERSED' })
    expect(leerReversa({ id: 'r-1', status: 'PENDING' })).toMatchObject({ ok: false }); expect(leerReversa({ status: 'REVERSED' })).toMatchObject({ ok: false })
    const h: Hallazgo = resumirHallazgo([leerTransaccion(tx('p-1', [auth()]))], ATT, 6000)
    const ev = textoEvidencia('admin:12345678', 'Cliente confirmó que no quiere el cargo', h, 'reversa REVERSED id r-1')
    expect(ev).toBe('[admin:12345678] Cliente confirmó que no quiere el cargo · proveedor: auth=aprobada:p-1 bill=ninguna reversa=ninguna void=ninguna tx=1 ref=ok importe=ok · reversa REVERSED id r-1')
    expect(ESTADOS_CONCILIACION).toEqual({ consultar: ['authz_sent', 'authorized', 'captured', 'unknown_requires_reconciliation', 'posted', 'declined'], resolver: ['authz_sent', 'unknown_requires_reconciliation', 'authorized', 'captured'], capturar: ['authorized'], reversar: ['authorized'], contabilizar: ['captured'], cerrar_manual: ['unknown_requires_reconciliation'] })
  })
  it('CS-1A.7 · cierre manual: 24 h desde lo MÁS tardío (envío o estado), motivo ≥ 10, consulta estructurada con las dos vías y Business Center', () => {
    expect(HORAS_MINIMAS_CIERRE).toBe(24); expect(MOTIVO_MINIMO_CIERRE).toBe(10); expect(MINUTOS_ENVIO_EN_VUELO).toBeGreaterThanOrEqual(1)
    const ahora = Date.parse('2026-10-22T12:00:00Z')
    expect(horasParaCierre({ cs_request_sent_at: '2026-10-21T00:00:00Z', status_at: '2026-10-21T18:00:00Z' }, ahora)).toBe(18)   // el estado es más reciente: manda
    expect(horasParaCierre({ cs_request_sent_at: '2026-10-20T12:00:00Z', status_at: '2026-10-21T11:00:00Z' }, ahora)).toBe(25)
    expect(horasParaCierre({ cs_request_sent_at: null, status_at: null }, ahora)).toBeNull()
    const h0 = resumirHallazgo([], ATT, 6000)
    const c = buildConsultaCierre({ realizada: true, resultado: 'no_encontrada' }, h0, 'billing:abc', new Date(ahora))
    expect(c).toEqual({ consultado_en: '2026-10-22T12:00:00.000Z', por_id: { realizada: true, resultado: 'no_encontrada' }, por_referencia: { realizada: true, transacciones: 0 }, business_center_revisado: true, operador: 'billing:abc' })
    const h1 = resumirHallazgo([leerTransaccion(tx('p-1', [auth()]))], ATT, 6000)
    expect(buildConsultaCierre({ realizada: false, motivo: 'sin_id' }, h1, 'admin:x').por_referencia.transacciones).toBe(1)   // la base rechaza (HALLAZGOS_EXISTEN)
  })
})

describe('CS-1A.6 · guardas de fuente de la Edge cs-conciliar', () => {
  const src = edge.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  it('solo admin/billing; transiciones con el JWT del operador; motivo obligatorio; estados permitidos por acción; consulta ANTES de capturar/reversar', () => {
    expect(src).toMatch(/tieneRol\(q\.quien, \['admin', 'billing'\]\)/)
    expect(src).toMatch(/caller\.rpc\('cs_intento_avanzar'/); expect(src).toMatch(/caller\.rpc\('cs_intento_contabilizar'/); expect(src).not.toMatch(/admin\.rpc\(/)
    expect(src).toMatch(/motivo\.length < 5\) return json\(400, \{ error: 'motivo_requerido'/)
    expect(src).toMatch(/accion === 'cerrar_manual' && motivo\.length < MOTIVO_MINIMO_CIERRE\) return json\(400/)
    expect(src).toMatch(/accion === 'cerrar_manual' && p\.business_center_revisado !== true\) return json\(400, \{ error: 'revision_requerida'/)
    expect(src).toMatch(/ESTADOS_CONCILIACION\[accion\]\.includes\(intento\.status\)/)
    const iCons = src.indexOf('const c = await consultar('), iCap = src.indexOf('/captures`'), iRev = src.indexOf('/reversals`')
    expect(iCons).toBeGreaterThan(0); expect(iCap).toBeGreaterThan(iCons); expect(iRev).toBeGreaterThan(iCons)
    expect(src).toMatch(/h\.captura\.estado !== 'ninguna'\) return json\(409, \{ error: 'captura_existente'/)
  })
  it('nunca reenvía la autorización, nunca escribe payment_entries, el operador no elige estados, reversa desconocida no libera', () => {
    expect(src).not.toMatch(/RUTAS_CS\.pagos, cuerpo|RUTAS_CS\.payer|registrar_cobro|payment_entries|_w2_asiento|console\.(log|warn|error)/)
    expect(src).not.toMatch(/p\.(estado|status|cs_payment_id|amount|importe)/)
    expect(src).toMatch(/decidirResolucion\(h, intento\.status\)/)
    expect(src).not.toMatch(/avanzar\('failed_safe_to_retry'/)   // CS-1A.7: ningún camino de la Edge cierra sin cargo por cs_intento_avanzar
    // toda entrada humana a authorized/captured lleva los hechos del proveedor
    expect(src).toMatch(/avanzar\('captured', \{ cs_payment_id: d\.cs_payment_id[^\n]*proveedor: h/); expect(src).toMatch(/avanzar\('authorized', \{ cs_payment_id: d\.cs_payment_id, evidencia, proveedor: h/)
    expect(src).toMatch(/avanzar\('captured', \{ \.\.\.datosCaptura\(lc\)[^\n]*proveedor: \{/)
    expect(src).toMatch(/reversa sin respuesta: la reserva se conserva/)
    expect(src).not.toMatch(/'posted'\)|avanzar\('posted'|'expired'/)
    expect(src).not.toMatch(/sharedSecret|keyId|firma\.headers|Signature/)
  })
  it('CS-1A.7 · cerrar_manual: 24 h antes de tocar al banco, las DOS consultas realizadas ahora (ambas=true), cualquier hallazgo o error impide cerrar, la base decide con el JWT del operador', () => {
    expect(src).toMatch(/accion === 'cerrar_manual' && \(horas == null \|\| horas < HORAS_MINIMAS_CIERRE\)\) return json\(409, \{ error: 'cierre_prematuro'/)
    expect(src).toMatch(/const c = await consultar\(accion === 'cerrar_manual'\)/)
    // en modo "ambas" el 200 por id NO corta: se hace también la búsqueda por referencia; los errores del proveedor devuelven 502/503 sin cerrar
    expect(src).toMatch(/porId\.resultado === 'encontrada' && !ambas\) return/)
    expect(src).toMatch(/if \(h\.transacciones > 0 \|\| \(c\.por_id\.realizada && c\.por_id\.resultado === 'encontrada'\)\) return json\(409, \{ error: 'hallazgos_existen'/)
    expect(src).toMatch(/caller\.rpc\('cs_intento_cerrar_manual', \{ p_attempt: attemptId, p_motivo: motivo, p_consulta: consulta \}\)/)
    expect(src).not.toMatch(/admin\.rpc\('cs_intento_cerrar_manual'/)
    const iPrem = src.indexOf("error: 'cierre_prematuro'"), iCons = src.indexOf('const c = await consultar('), iRpc = src.indexOf("caller.rpc('cs_intento_cerrar_manual'")
    expect(iPrem).toBeGreaterThan(0); expect(iCons).toBeGreaterThan(iPrem); expect(iRpc).toBeGreaterThan(iCons)
    // un envío sin respuesta solo pasa a desconocido cuando ya no puede estar en vuelo (y conserva la reserva); nunca a fallo seguro
    expect(src).toMatch(/intento\.status === 'authz_sent' && h\.transacciones === 0 && minutos != null && minutos >= MINUTOS_ENVIO_EN_VUELO/)
  })
})

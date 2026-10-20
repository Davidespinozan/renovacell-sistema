// PAQ-B · Recolección: reglas iguales en servidor y cliente, solicitud a DHL bien formada, respuestas del servidor
// leídas sin suponer nada, y guardas de fuente de la acción del servidor.
import { describe, it, expect, vi } from 'vitest'
import * as srv from '../../../../../supabase/functions/shipping/recoleccion'
import { buildPickupRequest, parsePickup } from '../../../../../supabase/functions/shipping/dhl'
import { errorRecoleccion, ahoraLocalOrigen, recoleccionDe, agendarRecoleccion, cancelarRecoleccion } from './recoleccion'
import edge from '../../../../../supabase/functions/shipping/index.ts?raw'

const HOY = '2026-10-14', MEDIODIA = 12 * 60
const ok = { date: HOY, ready: '13:00', close: '17:00', location: 'Recepción', instructions: 'Preguntar por Almacén' }

describe('reglas de recolección (mismas en servidor y cliente)', () => {
  const casos: Array<[string, object, RegExp | null]> = [
    ['válida hoy', ok, null], ['válida mañana temprano', { ...ok, date: '2026-10-15', ready: '08:00', close: '09:00' }, null],
    ['sin fecha', { ...ok, date: '' }, /fecha/], ['fecha pasada', { ...ok, date: '2026-10-13' }, /ya pasó/], ['a más de 10 días', { ...ok, date: '2026-10-25' }, /máximo 10 días/],
    ['fecha imposible', { ...ok, date: '2026-13-40' }, /fecha/], ['sin hora de inicio', { ...ok, ready: '' }, /listo/], ['hora inválida', { ...ok, close: '25:00' }, /hasta qué hora/],
    ['ventana de 30 min', { ...ok, ready: '13:00', close: '13:30' }, /al menos una hora/], ['cierre antes del inicio', { ...ok, ready: '16:00', close: '15:00' }, /al menos una hora/],
    ['hoy pero la hora ya pasó', { ...ok, ready: '09:00', close: '11:30' }, /ya pasó/], ['sin lugar', { ...ok, location: ' ' }, /dónde se recoge/],
    ['instrucciones de 81', { ...ok, instructions: 'x'.repeat(81) }, /80 caracteres/], ['nulo', null as unknown as object, /fecha/],
  ]
  for (const [nombre, entrada, esperado] of casos) {
    it(nombre, () => {
      const c = errorRecoleccion(entrada, HOY, MEDIODIA), s = srv.errorRecoleccion(entrada, HOY, MEDIODIA)
      expect(c).toBe(s)                                        // paridad cliente ↔ servidor
      if (esperado) expect(c ?? '').toMatch(esperado); else expect(c).toBeNull()
    })
  }
  it('hora local del origen (Culiacán, UTC-7), igual en ambos lados', () => {
    const t = Date.parse('2026-10-15T03:30:00Z')            // 20:30 del 14 en Culiacán
    expect(ahoraLocalOrigen(t)).toEqual({ hoy: '2026-10-14', ahoraMin: 20 * 60 + 30 })
    expect(srv.ahoraLocalOrigen(t)).toEqual(ahoraLocalOrigen(t))
  })
  it('el servidor limpia espacios y descarta instrucciones vacías', () => {
    expect(srv.limpiarRecoleccion({ ...ok, location: '  Recepción ', instructions: '  ' })).toEqual({ date: HOY, ready: '13:00', close: '17:00', location: 'Recepción' })
  })
})

describe('solicitud a DHL', () => {
  const shipper = { name: 'Renovacell', addressLine1: 'Nuevo Mundo 1045-17', cp: '80197', city: 'Culiacán', state: 'Sinaloa', country: 'MX', phone: '6670000000', email: 'envios@renovacell.test' }
  const pkg = { weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10, pieces: 1 }
  it('lleva fecha y ventana locales, cuenta, origen = lugar de recolección y el paquete de la guía', () => {
    const r = buildPickupRequest(shipper, pkg, '980000000', 'N', ok) as Record<string, any>
    expect(r.plannedPickupDateAndTime).toBe('2026-10-14T13:00:00 GMT-07:00'); expect(r.closeTime).toBe('17:00'); expect(r.location).toBe('Recepción')
    expect(r.accounts).toEqual([{ typeCode: 'shipper', number: '980000000' }])
    expect(r.customerDetails.pickupDetails.postalAddress).toMatchObject({ postalCode: '80197', cityName: 'Culiacán', countryCode: 'MX', addressLine1: 'Nuevo Mundo 1045-17' })
    expect(r.customerDetails.pickupDetails.contactInformation.phone).toBe('6670000000')
    expect(r.shipmentDetails).toEqual([{ productCode: 'N', isCustomsDeclarable: false, unitOfMeasurement: 'metric', packages: [{ weight: 1, dimensions: { length: 20, width: 15, height: 10 } }] }])
    expect(r.specialInstructions).toEqual([{ value: 'Preguntar por Almacén', typeCode: 'TBD' }])
    expect(buildPickupRequest(shipper, pkg, '9', 'N', { ...ok, instructions: undefined })).not.toHaveProperty('specialInstructions')
  })
  it('confirmación de DHL', () => {
    expect(parsePickup({ dispatchConfirmationNumbers: ['PRG201014001'] })).toEqual({ confirmation: 'PRG201014001' })
    expect(parsePickup({ dispatchConfirmationNumber: 'CBJ1' })).toEqual({ confirmation: 'CBJ1' })
    for (const d of [{}, null, { dispatchConfirmationNumbers: [] }]) expect(parsePickup(d).confirmation).toBe('')
  })
})

describe('cliente', () => {
  const rechazo = (code: string, message: string) => ({ data: null, error: { message: 'non-2xx', context: { json: async () => ({ error: code, message }) } } })
  it('recolección vigente de un envío: solo si hay confirmación', () => {
    expect(recoleccionDe({ pickup_confirmation: null, provider_meta: { pickup: ok } })).toBeNull()
    expect(recoleccionDe({ pickup_confirmation: 'PRG1', provider_meta: { pickup: { ...ok, confirmation: 'PRG1' } } })).toMatchObject({ confirmation: 'PRG1', date: HOY, ready: '13:00', location: 'Recepción' })
    expect(recoleccionDe({ pickup_confirmation: 'PRG1', provider_meta: null })).toEqual({ confirmation: 'PRG1', date: '', ready: '', close: '', location: '' })
  })
  it('agendar: éxito con confirmación; el motivo de la paquetería llega tal cual', async () => {
    const inv = vi.fn(async (_b: Record<string, unknown>) => ({ data: { pickup: { confirmation: 'PRG9' } } as unknown, error: null as unknown }))
    expect(await agendarRecoleccion('O-1', ok, inv)).toEqual({ ok: true, confirmation: 'PRG9' })
    expect(inv).toHaveBeenCalledWith({ action: 'schedule_pickup', order_id: 'O-1', pickup: ok })
    expect(await agendarRecoleccion('O-1', ok, async () => rechazo('proveedor', 'DHL 422: pickup time too late'))).toEqual({ ok: false, error: 'DHL 422: pickup time too late', desconocido: false })
  })
  it('resultado desconocido (sin respuesta, sin confirmación, no guardada) se marca para NO reintentar a ciegas', async () => {
    for (const c of ['resultado_desconocido', 'sin_confirmacion', 'no_guardada']) expect((await agendarRecoleccion('O-1', ok, async () => rechazo(c, 'x'))) ).toMatchObject({ ok: false, desconocido: true })
    expect(await agendarRecoleccion('O-1', ok, async () => { throw new TypeError('Failed to fetch') })).toMatchObject({ ok: false, desconocido: true })
    expect(await agendarRecoleccion('O-1', ok, async () => ({ data: {}, error: null }))).toMatchObject({ ok: false, desconocido: true })
  })
  it('cancelar', async () => {
    expect(await cancelarRecoleccion('O-1', 'x', async () => ({ data: { cancelled: true }, error: null }))).toEqual({ ok: true })
    expect(await cancelarRecoleccion('O-1', 'x', async () => rechazo('proveedor', 'DHL 404'))).toEqual({ ok: false, error: 'DHL 404' })
    expect((await cancelarRecoleccion('O-1', 'x', async () => ({ data: {}, error: null }))).ok).toBe(false)
  })
})

describe('servidor: guardas de fuente de la recolección', () => {
  const c = edge.replace(/^\s*\/\/.*$/gm, '')
  const b = c.slice(c.indexOf("if (action === 'schedule_pickup' || action === 'cancel_pickup')"), c.indexOf("if (action === 'rate' || action === 'create_shipment'"))
  it('solo logística; valida con las reglas compartidas; una recolección por guía', () => {
    expect(c.indexOf("if (!esLogistica) return json(403")).toBeLessThan(c.indexOf("if (action === 'schedule_pickup'"))
    expect(b).toMatch(/errorRecoleccion\(pedida, hoy, ahoraMin\)/)
    expect(b).toMatch(/if \(vigente\) return json\(200, \{ idempotent: true/)
    expect(b).toMatch(/sh\.status === 'delivered' \|\| sh\.status === 'cancelado'/)
  })
  it('usa el paquete, servicio y origen guardados en el envío; la escritura va con la identidad de quien agenda', () => {
    expect(b).toMatch(/sh\.package as NeutralPackage/); expect(b).toMatch(/sh\.ship_from as NeutralShipper/)
    expect(b).not.toMatch(/p\.(pkg|shipper|receiver)\b/)
    expect((b.match(/caller\.from\('shipments'\)\.update\(/g) ?? [])).toHaveLength(3)   // DHL agendar + DHL cancelar + T1 agendar (T1 no cancela desde el sistema)
    expect(b).not.toMatch(/admin\.from\('shipments'\)\.update/)
    expect(b).not.toMatch(/\.from\('orders'\)/)
  })
  it('sin respuesta de la paquetería ⇒ resultado desconocido (no se afirma éxito ni fracaso)', () => {
    expect((b.match(/resultado_desconocido/g) ?? []).length).toBe(3)   // + T1 agendar
  })
})

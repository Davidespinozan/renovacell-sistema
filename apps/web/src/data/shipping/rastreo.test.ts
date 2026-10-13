// PAQ-A · Rastreo neutral: traducción de eventos de DHL a los seis estados del sistema (servidor) y lectura segura
// de la respuesta en el cliente. Datos sintéticos con la forma de MyDHL (date/time/typeCode/serviceArea/signedBy).
import { describe, it, expect, vi } from 'vitest'
import { resumenDhl, recibioSegunPaqueteria, debeConsultar, CACHE_RASTREO_MS } from '../../../../../supabase/functions/shipping/rastreo'
import { leerRastreo, sincronizarRastreo } from './rastreo'
import edge from '../../../../../supabase/functions/shipping/index.ts?raw'

const ev = (date: string, time: string, typeCode: string, description: string, extra: object = {}) => ({ date, time, GMTOffset: '-07:00', typeCode, description, serviceArea: [{ code: 'CUL', description: 'Culiacán - MX' }], ...extra })
const dhl = (events: object[]) => ({ shipments: [{ shipmentTrackingNumber: '8664197986', events }] })

describe('traductor DHL → estado neutral', () => {
  it('sin eventos ⇒ sin_eventos', () => {
    for (const d of [{}, { shipments: [] }, dhl([]), null]) expect(resumenDhl(d)).toEqual({ estado: 'sin_eventos', descripcion: null, firmadoPor: null, entregadoAt: null, eventos: [] })
  })
  it('recolectado → en tránsito → en reparto: manda el evento más reciente, aunque lleguen desordenados', () => {
    const pu = ev('2026-10-13', '11:00:00', 'PU', 'Shipment picked up'), df = ev('2026-10-13', '15:10:00', 'DF', 'Departed Facility'), wc = ev('2026-10-14', '08:30:00', 'WC', 'With delivery courier')
    expect(resumenDhl(dhl([pu])).estado).toBe('recolectado')
    expect(resumenDhl(dhl([df, pu])).estado).toBe('en_transito')
    const r = resumenDhl(dhl([wc, pu, df]))
    expect(r.estado).toBe('en_reparto'); expect(r.descripcion).toBe('With delivery courier')
    expect(r.eventos.map((e) => e.code)).toEqual(['PU', 'DF', 'WC'])
    expect(r.eventos[0]).toEqual({ at: '2026-10-13T18:00:00.000Z', code: 'PU', description: 'Shipment picked up', location: 'Culiacán - MX' })
  })
  it('entregado: con quién firmó y cuándo; manda aunque después llegue un evento administrativo', () => {
    const r = resumenDhl(dhl([ev('2026-10-13', '11:00:00', 'PU', 'Picked up'), ev('2026-10-14', '09:42:00', 'OK', 'Delivered', { signedBy: 'JUAN PEREZ' }), ev('2026-10-14', '12:00:00', 'PL', 'Processed')]))
    expect(r.estado).toBe('entregado'); expect(r.firmadoPor).toBe('JUAN PEREZ'); expect(r.entregadoAt).toBe('2026-10-14T16:42:00.000Z')
    expect(recibioSegunPaqueteria(r, 'dhl')).toBe('JUAN PEREZ (confirmado por DHL)')
    expect(recibioSegunPaqueteria({ ...r, firmadoPor: null }, 'dhl')).toBe('Entrega confirmada por DHL')
  })
  it('incidencias (en espera, no estaba, domicilio incorrecto, rechazado, devuelto)', () => {
    for (const c of ['OH', 'NH', 'BA', 'RD', 'RT']) expect(resumenDhl(dhl([ev('2026-10-14', '10:00:00', c, 'x')])).estado).toBe('incidencia')
  })
  it('código desconocido ⇒ en tránsito (nunca entregado ni incidencia por adivinar)', () => {
    expect(resumenDhl(dhl([ev('2026-10-14', '10:00:00', 'ZZ', 'Delivered to neighbour maybe')])).estado).toBe('en_transito')
    expect(resumenDhl(dhl([ev('2026-10-14', '10:00:00', '', 'Delivered')])).estado).toBe('entregado')   // sin código: solo descripción inequívoca
    expect(resumenDhl(dhl([ev('2026-10-14', '10:00:00', '', 'Delivery attempted')])).estado).toBe('en_transito')
  })
  it('eventos sin fecha válida se ignoran; textos se acotan', () => {
    const r = resumenDhl(dhl([{ typeCode: 'OK', description: 'Delivered' }, ev('no-fecha', '10:00:00', 'OK', 'Delivered'), ev('2026-10-14', '10:00:00', 'PU', 'a'.repeat(900))]))
    expect(r.estado).toBe('recolectado'); expect(r.eventos).toHaveLength(1); expect(r.eventos[0].description).toHaveLength(300)
  })
  it('caché: no se consulta de nuevo antes de 10 min, salvo forzado; nunca después de entregado', () => {
    const t = Date.parse('2026-10-14T12:00:00Z')
    expect(debeConsultar(null, t, false)).toBe(true)
    expect(debeConsultar({ estado: 'en_transito', synced_at: new Date(t - 60_000).toISOString() }, t, false)).toBe(false)
    expect(debeConsultar({ estado: 'en_transito', synced_at: new Date(t - 60_000).toISOString() }, t, true)).toBe(true)
    expect(debeConsultar({ estado: 'en_transito', synced_at: new Date(t - CACHE_RASTREO_MS).toISOString() }, t, false)).toBe(true)
    expect(debeConsultar({ estado: 'entregado', synced_at: new Date(t - 9e9).toISOString() }, t, true)).toBe(false)
  })
})

describe('cliente: lectura segura y degradación', () => {
  const ok = { rastreo: { estado: 'en_reparto', descripcion: 'Con el repartidor', firmado_por: null, entregado_at: null, synced_at: '2026-10-14T15:00:00Z' }, eventos: [{ ocurrido_at: '2026-10-14T15:00:00Z', codigo: 'WC', descripcion: 'Con el repartidor', lugar: 'Culiacán' }, { codigo: 'X' }], aviso: null, cierre: null }
  it('lee estado, eventos válidos y descarta lo mal formado', () => {
    const r = leerRastreo(ok)!
    expect(r.estado).toBe('en_reparto'); expect(r.eventos).toEqual([{ at: '2026-10-14T15:00:00Z', codigo: 'WC', descripcion: 'Con el repartidor', lugar: 'Culiacán' }]); expect(r.actualizadoAt).toBe('2026-10-14T15:00:00Z')
  })
  it('respuestas raras ⇒ null (la pantalla no muestra rastreo)', () => {
    for (const d of [null, 'x', {}, { rastreo: null }, { rastreo: { estado: 'volando' } }, { error: 'sin_guia' }]) expect(leerRastreo(d)).toBeNull()
  })
  it('si el servidor aún no tiene la acción, falla o no hay red ⇒ null, sin lanzar', async () => {
    expect(await sincronizarRastreo('O-1', { invocar: async () => ({ data: null, error: { message: 'Function not found' } }) })).toBeNull()
    expect(await sincronizarRastreo('O-1', { invocar: async () => { throw new TypeError('Failed to fetch') } })).toBeNull()
    expect(await sincronizarRastreo('O-1', { invocar: async () => ({ data: { error: 'Solo staff de logística puede cotizar o generar guías.' }, error: null }) })).toBeNull()
  })
  it('pide la acción correcta; forzar solo viaja cuando se pide', async () => {
    const invocar = vi.fn(async (_cuerpo: Record<string, unknown>) => ({ data: ok as unknown, error: null as unknown }))
    expect((await sincronizarRastreo('O-9', { invocar }))?.estado).toBe('en_reparto')
    await sincronizarRastreo('O-9', { invocar, forzar: true })
    expect(invocar.mock.calls.map((c) => c[0])).toEqual([{ action: 'sync_tracking', order_id: 'O-9' }, { action: 'sync_tracking', order_id: 'O-9', force: true }])
  })
})

describe('servidor: guardas de fuente de la acción de rastreo', () => {
  const c = edge.replace(/^\s*\/\/.*$/gm, '')
  const bloque = c.slice(c.indexOf("if (action === 'sync_tracking')"), c.indexOf("if (!esLogistica) return json(403"))
  it('la visibilidad la decide la RLS de envíos con la identidad del llamante (no el cliente de servicio)', () => {
    expect(bloque).toMatch(/await caller\.from\('shipments'\)[\s\S]*?\.eq\('order_id', orderId\)/)
    expect(bloque).not.toMatch(/admin\.from\('shipments'\)/)
  })
  it('forzar es solo de logística y el cierre usa confirmar_entrega con la identidad de quien sincroniza', () => {
    expect(bloque).toMatch(/debeConsultar\(prev, Date\.now\(\), p\.force === true && esLogistica\)/)
    expect(bloque).toMatch(/if \(esLogistica\) \{\s*const \{ error: cErr \} = await caller\.rpc\('confirmar_entrega'/)
    expect(bloque).not.toMatch(/admin\.rpc\('confirmar_entrega'/)
    expect(bloque).not.toMatch(/\.from\('(shipments|orders)'\)\.update/)
  })
  it('reimprimir la etiqueta: acción propia, solo logística, sin llamar a la paquetería ni exigir destinatario/paquete', () => {
    const b = c.slice(c.indexOf("if (action === 'get_label')"), c.indexOf("if (action === 'schedule_pickup'"))
    expect(c.indexOf("if (!esLogistica) return json(403")).toBeLessThan(c.indexOf("if (action === 'get_label')"))
    expect(b).toMatch(/labelPayload\(admin, sh\)/)
    expect(b).not.toMatch(/fetch\(|missingReceiverPkg|companyShipper|DHL_API/)
    expect(b).not.toMatch(/\.(insert|update|delete)\(/)
  })
  it('cotizar y generar guías siguen siendo solo de logística', () => {
    expect(c).toMatch(/if \(!esLogistica\) return json\(403/)
    expect(c.indexOf("if (!esLogistica) return json(403")).toBeLessThan(c.indexOf("action === 'rate' || action === 'create_shipment'"))
  })
})

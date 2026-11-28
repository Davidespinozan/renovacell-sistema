// GUÍA HECHA FUERA DEL SISTEMA (28 nov 2026, Alberto) + UBICACIÓN EN LA ENTREGA (Manuela).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { registrarGuiaFuera, validarGuiaFuera } from './estafeta'
import { ubicacionConMotivo, recordarPosicion } from '../ops/ubicacionChofer'

describe('guía de DHL o T1 hecha en su portal', () => {
  it('valida el número y lo guarda en mayúsculas', () => {
    expect(validarGuiaFuera('t1', ' ab 12-34 ')).toEqual({ ok: true, guia: 'AB12-34' })
    expect(validarGuiaFuera('dhl', '')).toMatchObject({ ok: false })
    expect(validarGuiaFuera('dhl', 'x!')).toMatchObject({ ok: false })
  })
  it('se registra con su proveedor, marcada como manual; en T1 con la paquetería que se usó', async () => {
    const crear = vi.fn(async (x: unknown) => ({ ok: true as const, shipment: x as never }))
    await registrarGuiaFuera({ proveedor: 't1', paqueteria: 'Estafeta', orderId: 'o1', guia: 'G1234', costo: 150, llegaFecha: '2026-11-30', registradoPor: 'Alberto' }, crear as never)
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ provider: 't1', carrier: 'Estafeta (T1)', tracking_number: 'G1234', status: 'in_transit', provider_cost: 150,
      provider_meta: expect.objectContaining({ manual: true, fuera_del_sistema: true, paqueteria: 'Estafeta' }) }))
    await registrarGuiaFuera({ proveedor: 'dhl', orderId: 'o1', guia: '1234567890', costo: null, llegaFecha: null, registradoPor: null, paquete: 2 }, crear as never)
    expect(crear).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'dhl', carrier: 'DHL', paquete: 2 }))
  })
})

describe('ubicación para entregar', () => {
  const orig = (globalThis as { navigator?: Navigator }).navigator
  afterEach(() => { Object.defineProperty(globalThis, 'navigator', { value: orig, configurable: true }) })
  const pos = { coords: { latitude: 24.8, longitude: -107.4, accuracy: 30 } } as GeolocationPosition
  const conGeo = (fn: (ok: PositionCallback, err: PositionErrorCallback, o?: PositionOptions) => void) =>
    Object.defineProperty(globalThis, 'navigator', { value: { geolocation: { getCurrentPosition: vi.fn(fn) } }, configurable: true })

  it('si el GPS fino no engancha, la lectura rápida por red basta', async () => {
    conGeo((ok, err, o) => (o?.enableHighAccuracy ? err({ code: 3 } as GeolocationPositionError) : ok(pos)))
    expect(await ubicacionConMotivo(10_000, 0)).toEqual({ p: pos, motivo: null })
  })
  it('distingue «sin permiso» de «no encontró»', async () => {
    conGeo((_ok, err) => err({ code: 1 } as GeolocationPositionError))
    expect(await ubicacionConMotivo(10_000, 0)).toEqual({ p: null, motivo: 'permiso' })
    conGeo((_ok, err) => err({ code: 3 } as GeolocationPositionError))
    expect(await ubicacionConMotivo(10_000, 0)).toEqual({ p: null, motivo: 'no_encontro' })
  })
  it('usa la última posición reciente del rastreo de ruta sin volver a preguntar', async () => {
    conGeo((_ok, err) => err({ code: 3 } as GeolocationPositionError))
    recordarPosicion(pos)
    expect(await ubicacionConMotivo(10_000)).toEqual({ p: pos, motivo: null })
  })
})

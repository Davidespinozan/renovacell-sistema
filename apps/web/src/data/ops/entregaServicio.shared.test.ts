// ENTREGA-SERVICIO · cotizar al vender: paquete estimado por piezas, servicios del más barato al más caro con la diferencia
// que paga el cliente, la fecha exacta y el flete que se muestra (regla + diferencia; el ajuste del personal manda).
import { describe, it, expect, vi } from 'vitest'
import { paqueteEstimado, serviciosCotizados } from '../../../../../supabase/functions/_shared/cotizarEnvio'
import { fechaEntregaDhl } from '../../../../../supabase/functions/shipping/dhl'
import { fleteDeEleccion, llegadaServicio, mensajeServicio, precioServicio, promesaDe, type OpcionesEntrega } from './entrega'

vi.mock('../../lib/supabase', () => ({ hasSupabase: false, supabase: {} }))

describe('cotizar al vender', () => {
  it('paquete estimado: base + piezas, con mínimo y medidas de la configuración', () => {
    expect(paqueteEstimado(2, {})).toEqual({ weightKg: 1.6, lengthCm: 30, widthCm: 25, heightCm: 20, pieces: 1 })
    expect(paqueteEstimado(10, { paquete_kg_base: 0.5, paquete_kg_pieza: 0.25, paquete_largo_cm: 40 }).weightKg).toBe(3)
    expect(paqueteEstimado(0, { paquete_kg_base: 0.1, paquete_kg_pieza: 0 }).weightKg).toBe(0.5)
  })
  it('servicios: sin precio o sin código fuera; ordenados; diferencia contra el más barato; fecha exacta', () => {
    const s = serviciosCotizados([
      { serviceCode: '1', service: 'EXPRESS 12:00', amount: 421.68, etaDays: 1, entregaAt: '2026-11-05T12:00:00' },
      { serviceCode: 'N', service: 'EXPRESS DOMESTIC', amount: 330.62, etaDays: 1, entregaAt: '2026-11-05T23:59:00' },
      { serviceCode: 'X', service: 'GRATIS', amount: 0, etaDays: 1 },
      { service: 'SIN CÓDIGO', amount: 100, etaDays: 1 },
    ])
    expect(s.map((x) => x.codigo)).toEqual(['N', '1'])
    expect(s[0]).toMatchObject({ diferencia: 0, llega_fecha: '2026-11-05' })
    expect(s[1].diferencia).toBe(92)
    expect(serviciosCotizados([])).toEqual([])
  })
  it('sin fecha de la paquetería: hoy + días de tránsito (hora del negocio)', () => {
    const s = serviciosCotizados([{ serviceCode: 'N', service: 'X', amount: 100, etaDays: 2 }], Date.parse('2026-11-02T18:00:00Z'))
    expect(s[0].llega_fecha).toBe('2026-11-04')
  })
  it('fecha de la guía: la de DHL (hora local) o, sin ella, hoy + tránsito', () => {
    expect(fechaEntregaDhl('2026-11-05T12:00:00', 1)).toBe('2026-11-05T19:00:00.000Z')
    expect(fechaEntregaDhl(undefined, 2, Date.parse('2026-11-02T00:00:00Z'))).toBe('2026-11-04T00:00:00.000Z')
  })
  it('lo que ve el cliente: llegada, precio y la promesa con el servicio', () => {
    expect(llegadaServicio({ llega_fecha: '2026-11-05', llega_at: '2026-11-05T12:00:00' })).toBe('jueves 5 nov · antes de las 12:00')
    expect(llegadaServicio({ llega_fecha: '2026-11-05', llega_at: '2026-11-05T23:59:00' })).toBe('jueves 5 nov')
    expect(precioServicio(600, { diferencia: 92 })).toBe(692)
    expect(precioServicio(0, { diferencia: 0 })).toBe(0)
    expect(promesaDe({ tipo: 'foraneo', salida: '2026-11-03', llega_desde: '2026-11-05', llega_hasta: '2026-11-05', servicio: { proveedor: 'dhl', codigo: '1', nombre: 'X', llega_fecha: '2026-11-05', llega_at: '2026-11-05T12:00:00' } }))
      .toBe('Sale martes 3 nov · llega el jueves 5 nov · antes de las 12:00')
  })
  it('flete de la elección: regla + diferencia; el ajuste del personal manda', () => {
    const ops = { opciones: [{ id: 'foraneo_dhl', flete: 600 }] } as unknown as OpcionesEntrega
    expect(fleteDeEleccion({ opcion: 'foraneo_dhl', servicio: { cotizacion_id: 'c', codigo: '1', diferencia: 92 } }, ops)).toBe(692)
    expect(fleteDeEleccion({ opcion: 'foraneo_dhl' }, ops)).toBe(600)
    expect(fleteDeEleccion({ opcion: 'foraneo_dhl', flete: 0, motivo: 'cortesía', servicio: { cotizacion_id: 'c', codigo: '1', diferencia: 92 } }, ops)).toBe(0)
    expect(fleteDeEleccion(null, ops)).toBe(0)
  })
  it('errores del servidor en palabras', () => {
    expect(mensajeServicio('ENTREGA_COTIZACION_VENCIDA: x')).toMatch(/venció/)
    expect(mensajeServicio('otra cosa')).toBeNull()
  })
})

// PAQ-SIMPLE (23 nov 2026) · al vender solo se elige la paquetería; la cotización de DHL solo da la FECHA (la llegada más
// tardía de los servicios permitidos); ECONOMY SELECT ('G') nunca se ofrece; el cliente paga solo la regla.
import { describe, it, expect, vi } from 'vitest'
import { SERVICIOS_DHL_EXCLUIDOS, paqueteEstimado, promesaDeServicios, servicioDhlPermitido, serviciosCotizados, sinServiciosExcluidos } from '../../../../../supabase/functions/_shared/cotizarEnvio'
import { fechaEntregaDhl } from '../../../../../supabase/functions/shipping/dhl'
import { fechaLlegada, fleteDeEleccion, mensajeServicio, promesaCotizacion, promesaDe, resumenPaqueteria, textoLlegada, type OpcionesEntrega } from './entrega'

vi.mock('../../lib/supabase', () => ({ hasSupabase: false, supabase: {} }))

describe('PAQ-SIMPLE · cotizar al vender', () => {
  it('paquete estimado: base + piezas, con mínimo y medidas de la configuración', () => {
    expect(paqueteEstimado(2, {})).toEqual({ weightKg: 1.6, lengthCm: 30, widthCm: 25, heightCm: 20, pieces: 1 })
    expect(paqueteEstimado(10, { paquete_kg_base: 0.5, paquete_kg_pieza: 0.25, paquete_largo_cm: 40 }).weightKg).toBe(3)
    expect(paqueteEstimado(0, { paquete_kg_base: 0.1, paquete_kg_pieza: 0 }).weightKg).toBe(0.5)
  })
  it('ECONOMY SELECT (G) excluido en un solo lugar; la lista es configurable', () => {
    expect(SERVICIOS_DHL_EXCLUIDOS).toEqual(['G'])
    expect(servicioDhlPermitido('G')).toBe(false)
    expect(servicioDhlPermitido('g')).toBe(false)
    expect(servicioDhlPermitido('N')).toBe(true)
    expect(servicioDhlPermitido('')).toBe(false)
    expect(servicioDhlPermitido('N', ['N'])).toBe(false)
    expect(sinServiciosExcluidos([{ serviceCode: 'G', id: 1 }, { serviceCode: 'N', id: 2 }, { id: 3 }]).map((x) => x.id)).toEqual([2, 3])
  })
  it('servicios: sin precio, sin código o prohibidos fuera; ordenados; sin «diferencia»', () => {
    const s = serviciosCotizados([
      { serviceCode: '1', service: 'EXPRESS 12:00', amount: 421.68, etaDays: 1, entregaAt: '2026-11-05T12:00:00' },
      { serviceCode: 'N', service: 'EXPRESS DOMESTIC', amount: 330.62, etaDays: 1, entregaAt: '2026-11-05T23:59:00' },
      { serviceCode: 'G', service: 'ECONOMY SELECT', amount: 210, etaDays: 4, entregaAt: '2026-11-09T23:59:00' },
      { serviceCode: 'X', service: 'GRATIS', amount: 0, etaDays: 1 },
      { service: 'SIN CÓDIGO', amount: 100, etaDays: 1 },
    ])
    expect(s.map((x) => x.codigo)).toEqual(['N', '1'])
    expect(s[0]).toMatchObject({ llega_fecha: '2026-11-05' })
    expect(s[0]).not.toHaveProperty('diferencia')
    expect(serviciosCotizados([])).toEqual([])
  })
  it('sin fecha de la paquetería: hoy + días de tránsito (hora del negocio)', () => {
    const s = serviciosCotizados([{ serviceCode: 'N', service: 'X', amount: 100, etaDays: 2 }], Date.parse('2026-11-02T18:00:00Z'))
    expect(s[0].llega_fecha).toBe('2026-11-04')
  })
  it('la promesa de DHL: la llegada MÁS TARDÍA de los permitidos (G nunca cuenta)', () => {
    const servicios = [
      { codigo: '1', llega_fecha: '2026-11-04' }, { codigo: 'N', llega_fecha: '2026-11-05' }, { codigo: 'G', llega_fecha: '2026-11-09' },
    ]
    expect(promesaDeServicios(servicios)).toEqual({ codigo: 'N', llega_fecha: '2026-11-05' })
    expect(promesaDeServicios([{ codigo: 'G', llega_fecha: '2026-11-09' }])).toBeNull()
    expect(promesaDeServicios([])).toBeNull()
    expect(promesaCotizacion({ servicios: servicios.map((x) => ({ ...x, nombre: '', costo: 1 })) })?.llega_fecha).toBe('2026-11-05')
    expect(promesaCotizacion(null)).toBeNull()
  })
  it('fecha de la guía: la de DHL (hora local) o, sin ella, hoy + tránsito', () => {
    expect(fechaEntregaDhl('2026-11-05T12:00:00', 1)).toBe('2026-11-05T19:00:00.000Z')
    expect(fechaEntregaDhl(undefined, 2, Date.parse('2026-11-02T00:00:00Z'))).toBe('2026-11-04T00:00:00.000Z')
  })
  it('lo que ve el cliente: «Llega el lunes 23 de nov», rango y «DHL · llega …»', () => {
    expect(fechaLlegada('2026-11-23')).toBe('lunes 23 de nov')
    expect(textoLlegada('2026-11-23', '2026-11-23')).toBe('Llega el lunes 23 de nov')
    expect(textoLlegada('2026-11-23', '2026-11-25')).toBe('Llega entre el lunes 23 de nov y el miércoles 25 de nov')
    expect(textoLlegada('2026-11-23', '2026-11-23', '2026-11-23')).toBe('Llega hoy')
    expect(resumenPaqueteria({ tipo: 'foraneo', paqueteria: 'dhl', llega_desde: '2026-11-24', llega_hasta: '2026-11-24' })).toBe('DHL · llega el martes 24 de nov')
    expect(resumenPaqueteria({ tipo: 'foraneo', paqueteria: 'estafeta', llega_desde: '2026-11-25', llega_hasta: '2026-11-27' })).toBe('Estafeta · llega entre el miércoles 25 de nov y el viernes 27 de nov')
    expect(resumenPaqueteria({ tipo: 'local', paqueteria: 'chofer', llega_desde: '2026-11-24', llega_hasta: '2026-11-24' })).toBeNull()
    expect(promesaDe({ tipo: 'foraneo', salida: '2026-11-03', llega_desde: '2026-11-05', llega_hasta: '2026-11-05', servicio: { proveedor: 'dhl', llega_fecha: '2026-11-05' } }))
      .toBe('Sale martes 3 nov · llega el jueves 5 nov')
  })
  it('flete de la elección: SOLO la regla (sin recargo por la cotización); el ajuste del personal manda', () => {
    const ops = { opciones: [{ id: 'foraneo_dhl', flete: 600 }, { id: 'foraneo_estafeta', flete: 600 }] } as unknown as OpcionesEntrega
    expect(fleteDeEleccion({ opcion: 'foraneo_dhl', servicio: { cotizacion_id: 'c', codigo: '1' } }, ops)).toBe(600)
    expect(fleteDeEleccion({ opcion: 'foraneo_estafeta' }, ops)).toBe(600)
    expect(fleteDeEleccion({ opcion: 'foraneo_dhl', flete: 0, motivo: 'cortesía', servicio: { cotizacion_id: 'c', codigo: '1' } }, ops)).toBe(0)
    expect(fleteDeEleccion(null, ops)).toBe(0)
  })
  it('errores del servidor en palabras (pedidos de antes)', () => {
    expect(mensajeServicio('ENTREGA_COTIZACION_VENCIDA: x')).toMatch(/venció/)
    expect(mensajeServicio('otra cosa')).toBeNull()
  })
})

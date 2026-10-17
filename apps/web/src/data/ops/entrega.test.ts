// ENT-0 · Promesa de entrega en texto (lo que SIEMPRE ve el cliente) y pequeñas reglas de presentación. Sin red.
import { describe, it, expect } from 'vitest'
import { fechaCorta, fleteTexto, opcionDe, promesaDe, requiereDireccion, type OpcionesEntrega } from './entrega'

const OPS: OpcionesEntrega = {
  actor: 'doctor', subtotal: 1000, cp: '82000', local: false,
  corte: { hora: '15:30', zona: 'America/Mazatlan', antes_de_corte: true, hoy: '2026-10-21' },
  regla: { foraneo_gratis_desde: 5000, foraneo_flete: 600, local_gratis_desde: 500 },
  recoge: { lugar: 'Sucursal Renovacell, Culiacán', horario: 'Lunes a sábado de 10:00 a 18:00' },
  sugerida: 'foraneo_dhl',
  opciones: [
    { id: 'recoge', tipo: 'recoge', paqueteria: null, flete: 0, permitido: true, motivo: null, disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-21', llega_hasta: '2026-10-21', texto: 'Recoger en Sucursal Renovacell, Culiacán' },
    { id: 'foraneo_dhl', tipo: 'foraneo', paqueteria: 'dhl', flete: 600, permitido: true, motivo: null, disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-22', llega_hasta: '2026-10-26', texto: 'Envío por DHL' },
    { id: 'local_chofer', tipo: 'local', paqueteria: 'chofer', flete: 0, permitido: false, motivo: 'ZONA_FORANEA', disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-21', llega_hasta: '2026-10-21', texto: 'Entrega local (chofer de Renovacell)' },
  ],
}

describe('ENT-0 · promesa de entrega', () => {
  it('fechas sin pasar por la zona del navegador', () => {
    expect(fechaCorta('2026-10-21')).toBe('miércoles 21 oct')
    expect(fechaCorta('2026-10-26T00:00:00')).toBe('lunes 26 oct')
    expect(fechaCorta(null)).toBe(''); expect(fechaCorta('x')).toBe('')
  })
  it('envío foráneo: sale hoy y llega en un rango', () => {
    expect(promesaDe(OPS.opciones[1], '2026-10-21')).toBe('Sale hoy · llega entre el jueves 22 oct y el lunes 26 oct')
    expect(promesaDe(OPS.opciones[1], null)).toBe('Sale miércoles 21 oct · llega entre el jueves 22 oct y el lunes 26 oct')
  })
  it('local el mismo día, recoger con el lugar, mostrador en el acto', () => {
    expect(promesaDe(OPS.opciones[2], '2026-10-21')).toBe('Sale hoy · llega hoy mismo')
    expect(promesaDe({ tipo: 'local', salida: '2026-10-22', llega_desde: '2026-10-22', llega_hasta: '2026-10-22' }, '2026-10-21')).toBe('Sale jueves 22 oct · llega el jueves 22 oct')
    expect(promesaDe({ tipo: 'recoge', salida: '2026-10-21', llega_desde: '2026-10-21', llega_hasta: '2026-10-21', recoge: OPS.recoge }, '2026-10-21')).toBe('Listo para recoger hoy en Sucursal Renovacell, Culiacán')
    expect(promesaDe({ tipo: 'recoge', salida: '2026-10-26', llega_desde: '2026-10-26', llega_hasta: '2026-10-26' }, '2026-10-24')).toBe('Listo para recoger el lunes 26 oct')
    expect(promesaDe({ tipo: 'mostrador', salida: '2026-10-21', llega_desde: '2026-10-21', llega_hasta: '2026-10-21' })).toBe('Te lo llevas ahora')
  })
  it('flete, dirección requerida y búsqueda de opción', () => {
    const money = (n: number) => `$${n}`
    expect(fleteTexto(0, money)).toBe('Gratis'); expect(fleteTexto(600, money)).toBe('$600'); expect(fleteTexto(null, money)).toBe('Gratis')
    expect(requiereDireccion('foraneo')).toBe(true); expect(requiereDireccion('local')).toBe(true); expect(requiereDireccion('recoge')).toBe(false); expect(requiereDireccion(null)).toBe(false)
    expect(opcionDe(OPS, 'foraneo_dhl')?.flete).toBe(600); expect(opcionDe(OPS, 'dron')).toBeNull(); expect(opcionDe(null, 'recoge')).toBeNull()
  })
})

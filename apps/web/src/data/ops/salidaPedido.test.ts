// HORA DE SALIDA (26 nov 2026, dueño: «los pedidos deberían mostrar a qué hora salen»).
import { describe, it, expect } from 'vitest'
import { salidaDePedido, hora12 } from './entrega'

const HOY = '2026-11-26'
describe('hora de salida del pedido', () => {
  it('entrega local: sale antes de que empiece su horario reservado', () => {
    const s = salidaDePedido({ tipo: 'local', salida: HOY, paqueteria: 'chofer', horario: { fecha: HOY, inicio: '16:30', fin: '17:00' } }, HOY)!
    expect(s.etiqueta).toBe('Sale hoy antes de las 4:30 p.m.'); expect(s.cuando).toBe('hoy'); expect(s.orden).toBe('2026-11-26T16:30')
  })
  it('paquetería: sale antes de la hora de corte de la regla de entrega', () => {
    expect(salidaDePedido({ tipo: 'foraneo', salida: HOY, paqueteria: 'dhl' }, HOY, '15:30')!.etiqueta).toBe('Sale hoy antes de las 3:30 p.m.')
    expect(salidaDePedido({ tipo: 'foraneo', salida: '2026-11-27', paqueteria: 'estafeta' }, HOY, '14:00')!.etiqueta).toBe('Sale el 27/11 antes de las 2:00 p.m.')
  })
  it('atrasado: dice cuándo debió salir; recoger en sucursal no lleva hora; mostrador no aplica', () => {
    const a = salidaDePedido({ tipo: 'local', salida: '2026-11-24', horario: { fecha: '2026-11-24', inicio: '11:00', fin: '11:30' } }, HOY)!
    expect(a.cuando).toBe('atrasado'); expect(a.etiqueta).toBe('Debió salir el 24/11 antes de las 11:00 a.m.')
    expect(salidaDePedido({ tipo: 'recoge', salida: HOY }, HOY)!.etiqueta).toBe('Lo recogen hoy')
    expect(salidaDePedido({ tipo: 'mostrador', salida: HOY }, HOY)).toBeNull()
    expect(hora12('12:05')).toBe('12:05 p.m.'); expect(hora12('00:10')).toBe('12:10 a.m.')
  })
  it('ordena por día y hora: primero lo que sale más temprano', () => {
    const o = (e: Parameters<typeof salidaDePedido>[0]) => salidaDePedido(e, HOY)!.orden
    const claves = [o({ tipo: 'foraneo', salida: HOY }), o({ tipo: 'local', salida: HOY, horario: { fecha: HOY, inicio: '11:00', fin: '11:30' } }), o({ tipo: 'local', salida: '2026-11-25', horario: { fecha: '2026-11-25', inicio: '17:00', fin: '17:30' } })]
    expect([...claves].sort()).toEqual([claves[2], claves[1], claves[0]])
  })
})

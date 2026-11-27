import { describe, expect, it } from 'vitest'
import { agruparPorSalida, grupoDeSalida } from './entrega'

const HOY = '2026-11-27'
describe('almacén · la fila del día se agrupa por cuándo sale y con quién', () => {
  it('paquetería: la hora es el corte y dice con quién va', () => {
    expect(grupoDeSalida({ tipo: 'foraneo', salida: HOY, paqueteria: 'dhl' }, HOY, '15:30')).toEqual({ titulo: 'Sale hoy antes de las 3:30 p.m. · DHL', cuando: 'hoy' })
    expect(grupoDeSalida({ tipo: 'foraneo', salida: HOY, paqueteria: 'estafeta' }, HOY, '15:30').titulo).toBe('Sale hoy antes de las 3:30 p.m. · Estafeta')
  })
  it('local con chofer: la hora es el inicio del horario prometido', () => {
    const g = grupoDeSalida({ tipo: 'local', salida: HOY, paqueteria: 'chofer', horario: { fecha: HOY, inicio: '16:00', fin: '18:00' } as never }, HOY)
    expect(g).toEqual({ titulo: 'Sale hoy antes de las 4:00 p.m. · chofer', cuando: 'hoy' })
  })
  it('recoger en sucursal no lleva «con quién»', () => {
    expect(grupoDeSalida({ tipo: 'recoge', salida: HOY }, HOY).titulo).toBe('Lo recogen hoy')
  })
  it('lo atrasado lo dice, y lo que no tiene fecha queda en su grupo', () => {
    expect(grupoDeSalida({ tipo: 'foraneo', salida: '2026-11-25', paqueteria: 'dhl' }, HOY, '15:30')).toEqual({ titulo: 'Debió salir el 25/11 antes de las 3:30 p.m. · DHL', cuando: 'atrasado' })
    expect(grupoDeSalida(null, HOY)).toEqual({ titulo: 'Sin fecha de salida', cuando: 'sin' })
    expect(grupoDeSalida({ tipo: 'mostrador', salida: HOY }, HOY)).toEqual({ titulo: 'Entrega en mostrador', cuando: 'sin' })
  })
  it('agrupa tramos consecutivos con el mismo título', () => {
    const lista = [{ id: 1, t: 'A' }, { id: 2, t: 'A' }, { id: 3, t: 'B' }, { id: 4, t: 'A' }]
    const g = agruparPorSalida(lista, (x) => ({ titulo: x.t, cuando: 'hoy' }))
    expect(g.map((x) => [x.titulo, x.items.map((i) => i.id)])).toEqual([['A', [1, 2]], ['B', [3]], ['A', [4]]])
  })
})

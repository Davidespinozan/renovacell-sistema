// DHL-FECHA (23 nov 2026) · la cotización de DHL se pide para la SALIDA REAL (misma regla que public._entrega_salida).
// Caso real: 38406 Valle de Santiago, lunes 23 nov antes del corte → se cotizaba como si saliera el martes (DHL: lunes 30).
import { describe, expect, it } from 'vitest'
import { fechaPlaneadaDhl, relojLocal, salidaPaqueteria } from '../../../../../supabase/functions/_shared/cotizarEnvio'

const regla = { corte: '15:30:00', dias: [1, 2, 3, 4, 5], zona: 'America/Mazatlan' }
const mx = (iso: string) => Date.parse(iso + '-07:00')   // hora de Culiacán

describe('DHL-FECHA · salida real para cotizar', () => {
  it('lunes antes del corte: sale HOY', () => {
    expect(salidaPaqueteria(mx('2026-11-23T11:14:00'), regla)).toBe('2026-11-23')
  })
  it('después del corte: el siguiente día de paquetería', () => {
    expect(salidaPaqueteria(mx('2026-11-23T15:30:00'), regla)).toBe('2026-11-24')
    expect(salidaPaqueteria(mx('2026-11-27T16:00:00'), regla)).toBe('2026-11-30')   // viernes tarde → lunes
  })
  it('fin de semana y días cerrados se saltan', () => {
    expect(salidaPaqueteria(mx('2026-11-28T09:00:00'), regla)).toBe('2026-11-30')   // sábado
    expect(salidaPaqueteria(mx('2026-11-23T09:00:00'), { ...regla, cerrados: ['2026-11-23', '2026-11-24'] })).toBe('2026-11-25')
  })
  it('fecha planeada para MyDHL: hoy dentro de 30 min con desfase de Culiacán; otro día a las 12:00', () => {
    expect(fechaPlaneadaDhl(mx('2026-11-23T11:14:00'), regla)).toBe('2026-11-23T11:44:00 GMT-07:00')
    expect(fechaPlaneadaDhl(mx('2026-11-23T17:00:00'), regla)).toBe('2026-11-24T12:00:00 GMT-07:00')
  })
  it('el reloj local no depende de la zona de la máquina (UTC de las Edges)', () => {
    expect(relojLocal(Date.parse('2026-11-24T05:30:00Z'))).toEqual({ dia: '2026-11-23', hora: '22:30', desfase: 'GMT-07:00' })
  })
})

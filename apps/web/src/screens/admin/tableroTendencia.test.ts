// CALIDAD VISUAL · tendencia del mes del Tablero: acumulado por día de negocio, sin cancelados, mes anterior para comparar.
import { describe, it, expect } from 'vitest'
import { serieMes } from './Tablero'

describe('serieMes', () => {
  const orders = [
    { created_at: '2026-11-02T18:00:00Z', total: 1000, status: 'delivered' },
    { created_at: '2026-11-05T18:00:00Z', total: 500, status: 'paid' },
    { created_at: '2026-11-05T19:00:00Z', total: 9999, status: 'cancelled' },
    { created_at: '2026-10-03T18:00:00Z', total: 800, status: 'delivered' },
  ]
  it('acumula este mes hasta hoy y el mes pasado completo', () => {
    const s = serieMes(orders, '2026-11-06')
    expect(s).toHaveLength(30)
    expect(s[0]).toEqual({ dia: 1, este: 0, anterior: 0 })
    expect(s[4]).toMatchObject({ dia: 5, este: 1500, anterior: 800 })
    expect(s[5].este).toBe(1500)
    expect(s[6].este).toBeNull()          // después de hoy no se dibuja
    expect(s[29].anterior).toBe(800)
  })
  it('enero compara contra diciembre del año anterior', () => {
    const s = serieMes([{ created_at: '2025-12-10T18:00:00Z', total: 300, status: 'paid' }], '2026-01-15')
    expect(s[14].anterior).toBe(300)
  })
})

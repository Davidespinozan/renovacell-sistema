import { describe, it, expect } from 'vitest'
import { etapaSeguimiento, fechaHora } from './seguimientoVenta'

describe('seguimiento de entrega en Ventas del equipo', () => {
  it('toma el último paso con su hora (hora de Mazatlán)', () => {
    const s = { empacado_at: '2026-11-24T22:04:43Z', salio_at: '2026-11-24T22:05:43Z', entregado_at: '2026-11-24T22:35:09Z' }
    const e = etapaSeguimiento({ status: 'delivered', seguimiento: s })
    expect(e.etapa).toBe('entregado')
    expect(e.texto).toContain('24 nov')
    expect(e.texto).toMatch(/3:35/)
    expect(etapaSeguimiento({ status: 'shipped', seguimiento: { salio_at: s.salio_at } }).etapa).toBe('salio')
    expect(etapaSeguimiento({ status: 'packed', seguimiento: { empacado_at: s.empacado_at } }).etapa).toBe('empacado')
  })
  it('sin pasos: aún en almacén; cancelado manda', () => {
    expect(etapaSeguimiento({ status: 'paid', seguimiento: {} }).texto).toBe('Aún en almacén')
    expect(etapaSeguimiento({ status: 'cancelled', seguimiento: { salio_at: '2026-11-24T22:05:43Z' } }).etapa).toBe('cancelado')
    expect(fechaHora(null)).toBe('')
  })
})

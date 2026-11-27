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
    expect(etapaSeguimiento({ status: 'paid', seguimiento: {} }).texto).toBe('En almacén · por preparar')
    expect(etapaSeguimiento({ status: 'cancelled', seguimiento: { salio_at: '2026-11-24T22:05:43Z' } }).etapa).toBe('cancelado')
    expect(fechaHora(null)).toBe('')
    expect(etapaSeguimiento({ status: 'pending_payment', payment_method: 'por_cobrar', seguimiento: {} }).etapa).toBe('por_confirmar')
    expect(etapaSeguimiento({ status: 'pending_payment', payment_method: 'contra_entrega', seguimiento: {} }).etapa).toBe('almacen')
  })
})

// UN SOLO IDIOMA (27 nov 2026): primero el paso con las palabras de todos; después, el detalle.
describe('seguimiento · mismas palabras que el resto del sistema', () => {
  it('cada momento empieza con su paso', () => {
    expect(etapaSeguimiento({ status: 'pending_payment', payment_method: 'por_cobrar', seguimiento: {} }).texto).toBe('Por confirmar · falta el pago')
    expect(etapaSeguimiento({ status: 'packed', seguimiento: {} }).texto).toBe('En almacén · preparado')
    expect(etapaSeguimiento({ status: 'shipped', seguimiento: {} }).texto).toBe('En camino')
    expect(etapaSeguimiento({ status: 'shipped', seguimiento: { salio_at: '2026-11-24T22:05:43Z' } }).texto).toMatch(/^En camino · salió 24 nov/)
    expect(etapaSeguimiento({ status: 'delivered', seguimiento: {} }).texto).toBe('Entregado')
  })
  it('quien recoge en sucursal no va «en camino»: está listo para recoger', () => {
    expect(etapaSeguimiento({ status: 'shipped', shipping_meta: { method: 'recoge' }, seguimiento: {} }).texto).toBe('Listo para recoger')
  })
})

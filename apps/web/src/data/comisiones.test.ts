// W5-04 · Comisiones = ESTIMACIÓN. Vendido y cobrado separados; sin reversas inferidas;
// sin tasas históricas; sin vendedor inventado.
import { describe, it, expect } from 'vitest'
import { estimarComisiones, vendedorDe } from './comisiones'
import { periodoMes } from './periodo'
import { mkOrder, mkItem } from '../test/factories'

const V = [{ email: 'a@x.mx', name: 'Ana · Ventas' }, { email: 'b@x.mx', name: 'Beto · Ventas' }]
const base = {
  vendedores: V,
  lineaDe: (pid: string | null) => (pid === 'prof' ? 'prof' as const : 'cosm' as const),
  tasaVigente: { cosm: 0.04, prof: 0.06 },
}
const SEP = periodoMes('2026-09')
const pedido = (id: string, seller: string | null, created_at: string, items: { product_id: string; qty: number; unit_price: number }[], over = {}) =>
  mkOrder({ id, external_ref: id, created_at, shipping_meta: seller ? { seller } : null, status: 'delivered',
    total: items.reduce((s, i) => s + i.qty * i.unit_price, 0), items: items.map((i, n) => mkItem({ id: `${id}-${n}`, order_id: id, ...i })), ...over })

describe('estimarComisiones', () => {
  it('estima por línea con la tasa VIGENTE y separa vendido de cobrado', () => {
    const orders = [pedido('S1', 'a@x.mx', '2026-09-10T18:00:00Z', [{ product_id: 'cosm', qty: 1, unit_price: 1000 }, { product_id: 'prof', qty: 1, unit_price: 500 }])]
    const entries = [{ order_id: 'S1', direction: 'in' as const, amount: 600, value_date: '2026-09-12' }]
    const r = estimarComisiones({ ...base, orders, entries }, SEP)
    const ana = r.filas.find((f) => f.email === 'a@x.mx')!
    expect(ana).toMatchObject({ pedidos: 1, vendido: 1500, cobrado: 600, comisionEstimada: 1000 * 0.04 + 500 * 0.06 })
    expect(r.filas.find((f) => f.email === 'b@x.mx')).toMatchObject({ pedidos: 0, vendido: 0, cobrado: 0, comisionEstimada: 0 })
  })
  it('un pedido de agosto cobrado en septiembre: cobrado de septiembre, vendido de agosto', () => {
    const orders = [pedido('S1', 'a@x.mx', '2026-08-20T18:00:00Z', [{ product_id: 'cosm', qty: 1, unit_price: 1000 }])]
    const entries = [{ order_id: 'S1', direction: 'in' as const, amount: 1000, value_date: '2026-09-03' }]
    const r = estimarComisiones({ ...base, orders, entries }, SEP)
    expect(r.filas.find((f) => f.email === 'a@x.mx')).toMatchObject({ vendido: 0, cobrado: 1000, comisionEstimada: 0 })
  })
  it('una devolución baja el cobrado (es un hecho del libro) pero NO descuenta la estimación (regla no decidida)', () => {
    const orders = [pedido('S1', 'a@x.mx', '2026-09-10T18:00:00Z', [{ product_id: 'cosm', qty: 1, unit_price: 1000 }])]
    const entries = [
      { order_id: 'S1', direction: 'in' as const, amount: 1000, value_date: '2026-09-10' },
      { order_id: 'S1', direction: 'out' as const, amount: 300, value_date: '2026-09-15' },
    ]
    const ana = estimarComisiones({ ...base, orders, entries }, SEP).filas[0]
    expect(ana).toMatchObject({ cobrado: 700, vendido: 1000, comisionEstimada: 40 })
  })
  it('sin vendedor registrado no se inventa uno: va aparte y fuera de la estimación', () => {
    const orders = [pedido('POS-1', null, '2026-09-10T18:00:00Z', [{ product_id: 'cosm', qty: 2, unit_price: 100 }])]
    const r = estimarComisiones({ ...base, orders, entries: [] }, SEP)
    expect(r.sinVendedor).toEqual({ pedidos: 1, vendido: 200 })
    expect(r.totales.comisionEstimada).toBe(0)
  })
  it('cancelados y borradores no son venta; pedidos de las 23:30 del 30-sep (Mazatlán) son de septiembre', () => {
    const orders = [
      pedido('S1', 'a@x.mx', '2026-10-01T06:30:00Z', [{ product_id: 'cosm', qty: 1, unit_price: 100 }]),
      pedido('S2', 'a@x.mx', '2026-09-10T18:00:00Z', [{ product_id: 'cosm', qty: 1, unit_price: 900 }], { status: 'cancelled' }),
    ]
    expect(estimarComisiones({ ...base, orders, entries: [] }, SEP).filas[0]).toMatchObject({ pedidos: 1, vendido: 100 })
  })
  it('atribuye por placed_by solo si coincide con un vendedor existente', () => {
    expect(vendedorDe(mkOrder({ shipping_meta: { placed_by: 'Ana · Ventas (x)' } }), V)).toBe('a@x.mx')
    expect(vendedorDe(mkOrder({ shipping_meta: { placed_by: 'Nadie' } }), V)).toBeNull()
  })
})

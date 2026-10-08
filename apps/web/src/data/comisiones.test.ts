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
  // CX-0c · D2: el capturista (placed_by) NO es vendedor. Antes se atribuía por prefijo de nombre; ya no.
  it('CX-0c · placed_by (capturista) nunca atribuye comisión', () => {
    expect(vendedorDe(mkOrder({ shipping_meta: { placed_by: 'Ana · Ventas (x)' } }), V)).toBeNull()
    expect(vendedorDe(mkOrder({ shipping_meta: { placed_by: 'Ana · Ventas (Ventas)', seller_origen: 'sin_vendedor' } }), V)).toBeNull()
  })
})

describe('CX-0c · identidad canónica del vendedor', () => {
  const VI = [{ id: 'id-ana', email: 'a@x.mx', name: 'Ana · Ventas' }, { id: 'id-beto', email: 'b@x.mx', name: 'Beto · Ventas' }]
  it('1 · seller_profile_id manda (aunque el correo guardado sea otro, p. ej. cambió su correo)', () => {
    expect(vendedorDe(mkOrder({ shipping_meta: { seller_profile_id: 'id-beto', seller: 'viejo@x.mx', seller_origen: 'cartera' } }), VI)).toBe('b@x.mx')
  })
  it('2 · compatibilidad: pedido anterior a CX-0c solo con correo', () => {
    expect(vendedorDe(mkOrder({ shipping_meta: { seller: 'a@x.mx' } }), VI)).toBe('a@x.mx')
  })
  it('2b · id que no está en la lista activa: se conserva el correo congelado (no se pierde ni se inventa)', () => {
    expect(vendedorDe(mkOrder({ shipping_meta: { seller_profile_id: 'id-baja', seller: 'baja@x.mx' } }), VI)).toBe('baja@x.mx')
  })
  it('3 · sin vendedor (sin_vendedor / no_resoluble) → null, aunque haya capturista', () => {
    expect(vendedorDe(mkOrder({ shipping_meta: { seller_origen: 'no_resoluble', placed_by: 'Ana · Ventas (Ventas)' } }), VI)).toBeNull()
    expect(vendedorDe(mkOrder({ shipping_meta: { seller_origen: 'sin_vendedor' } }), VI)).toBeNull()
  })
  it('POS: venta atribuida a cartera ≠ cajero; venta sin cartera → cajero (lo decide el servidor, aquí solo se lee)', () => {
    expect(vendedorDe(mkOrder({ shipping_meta: { channel: 'pos', seller_profile_id: 'id-ana', seller: 'a@x.mx', seller_origen: 'cartera' } }), VI)).toBe('a@x.mx')
    expect(vendedorDe(mkOrder({ shipping_meta: { channel: 'pos', seller_profile_id: 'id-beto', seller: 'b@x.mx', seller_origen: 'pos_cajero' } }), VI)).toBe('b@x.mx')
  })
  it('la estimación agrupa por el vendedor canónico y deja el resto en «sin vendedor»', () => {
    const base = { vendedores: VI, lineaDe: () => 'cosm' as const, tasaVigente: { cosm: 0.1, prof: 0.05 }, entries: [] }
    const SEPT = { desde: '2026-09-01', hasta: '2026-09-30' }
    const orders = [
      mkOrder({ id: 'o1', external_ref: 'o1', created_at: '2026-09-10T18:00:00Z', status: 'delivered', shipping_meta: { seller_profile_id: 'id-ana', seller: 'a@x.mx' }, items: [mkItem({ product_id: 'p', qty: 1, unit_price: 100 })] }),
      mkOrder({ id: 'o2', external_ref: 'o2', created_at: '2026-09-11T18:00:00Z', status: 'delivered', shipping_meta: { placed_by: 'Beto · Ventas (Ventas)', seller_origen: 'sin_vendedor' }, items: [mkItem({ product_id: 'p', qty: 1, unit_price: 50 })] }),
    ]
    const est = estimarComisiones({ ...base, orders }, SEPT)
    expect(est.filas.find((f) => f.email === 'a@x.mx')).toMatchObject({ pedidos: 1, vendido: 100 })
    expect(est.filas.find((f) => f.email === 'b@x.mx')).toMatchObject({ pedidos: 0, vendido: 0 })
    expect(est.sinVendedor).toMatchObject({ pedidos: 1, vendido: 50 })
  })
})

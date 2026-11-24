// VENTAS POR VENDEDOR · misma atribución que comisiones (vendedor de cartera congelado), «Sin vendedor» al final.
import { describe, it, expect } from 'vitest'
import { ventasPorVendedor, nombreVendedorDe, SIN_VENDEDOR } from './comisiones'
import type { OrderWithItems } from './hooks/useOrders'

const V = [{ id: 'u-ale', email: 'ale@x.com', name: 'Alejandra' }, { id: 'u-rob', email: 'rob@x.com', name: 'Roberto' }]
const o = (meta: Record<string, unknown>, total: number, status = 'paid') => ({ id: String(Math.random()), shipping_meta: meta, total, status, items: [] }) as unknown as OrderWithItems

describe('ventasPorVendedor', () => {
  it('agrupa por vendedor de cartera, ordena por venta y deja «Sin vendedor» al final', () => {
    const r = ventasPorVendedor([
      o({ seller_profile_id: 'u-ale', placed_by: 'Roberto (Ventas)' }, 500),
      o({ seller_profile_id: 'u-rob' }, 900),
      o({ seller: 'ale@x.com' }, 700),
      o({}, 5000),
      o({ seller_profile_id: 'u-rob' }, 100, 'cancelled'),
    ], V)
    expect(r.map((x) => [x.nombre, x.orders, x.revenue])).toEqual([['Alejandra', 2, 1200], ['Roberto', 1, 900], ['Sin vendedor', 1, 5000]])
  })
  it('el capturista no atribuye: manda el vendedor del pedido', () => {
    expect(nombreVendedorDe(o({ seller_profile_id: 'u-ale', placed_by: 'Roberto (Ventas)' }, 1), V).nombre).toBe('Alejandra')
    expect(nombreVendedorDe(o({ placed_by: 'Roberto (Ventas)' }, 1), V).clave).toBe(SIN_VENDEDOR)
  })
})

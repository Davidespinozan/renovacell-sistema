// Pruebas del ajuste por DEVOLUCIONES en los reportes: las devoluciones se restan
// del neto (estado de resultados) y del efectivo esperado del arqueo.
import { describe, it, expect } from 'vitest'
import { estadoResultados, efectivoEsperado, type RefundLine } from './finanzas'
import { mkOrder } from '../../test/factories'

describe('estadoResultados — devoluciones', () => {
  const ventas = [
    mkOrder({ id: '1', external_ref: 'S-1', status: 'paid', total: 1000 }),
    mkOrder({ id: '2', external_ref: 'S-2', status: 'paid', total: 1000 }),
  ]
  it('resta las devoluciones de las ventas netas', () => {
    const er = estadoResultados(ventas, [], [], [], [{ order_id: '1', monto: 300 }])
    expect(er.ventas).toBe(2000)          // brutas, sin tocar
    expect(er.devoluciones).toBe(300)
    expect(er.ventasNetas).toBe(1700)
    expect(er.utilidadBruta).toBe(1700)   // sin costo de ventas en este caso
  })
  it('ignora devoluciones de pedidos fuera del periodo', () => {
    const er = estadoResultados(ventas, [], [], [], [{ order_id: 'zzz', monto: 500 }])
    expect(er.devoluciones).toBe(0)
    expect(er.ventasNetas).toBe(2000)
  })
  it('sin devoluciones, el neto es igual a las ventas (compat)', () => {
    const er = estadoResultados(ventas, [], [], [])
    expect(er.devoluciones).toBe(0)
    expect(er.ventasNetas).toBe(er.ventas)
  })
})

describe('efectivoEsperado — devoluciones en efectivo', () => {
  const day = '2026-06-15'
  const orders = [mkOrder({ id: '1', external_ref: 'POS-1', payment_method: 'efectivo', total: 300, created_at: `${day}T10:00:00Z` })]
  const dev = (r: Partial<RefundLine>): RefundLine => ({ order_id: '1', monto: 100, metodo: 'efectivo', ...r })

  it('resta la devolución en efectivo del pedido en alcance', () => {
    expect(efectivoEsperado(orders, { day }, [dev({})])).toBe(200)
  })
  it('una devolución con tarjeta NO baja el efectivo esperado', () => {
    expect(efectivoEsperado(orders, { day }, [dev({ metodo: 'tarjeta' })])).toBe(300)
  })
  it('ignora devoluciones de pedidos fuera del alcance', () => {
    expect(efectivoEsperado(orders, { day }, [dev({ order_id: 'otro' })])).toBe(300)
  })
})
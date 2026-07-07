// Casos distintos adicionales para ampliar cobertura de la lógica pura.
import { describe, it, expect } from 'vitest'
import { money } from '../lib/format'
import {
  isSale, isPosOrder, salesSummary, channelSplit, doctorActivity,
  topDoctors, lineMix, monthlySales, billingSummary,
} from './metrics'
import { stockByProduct } from './ops/stock'
import { allocateFEFO } from './ops/surtir'
import { mkOrder, mkItem, mkProduct, mkLot } from '../test/factories'

describe('money — variados', () => {
  it('cero', () => { expect(money(0)).toContain('0') })
  it('millón', () => { expect(money(1_000_000)).toContain('1,000,000') })
})

describe('isSale/isPosOrder — combinaciones', () => {
  it('fulfilled cuenta como venta', () => { expect(isSale(mkOrder({ status: 'fulfilled' }))).toBe(true) })
  it('picking cuenta como venta', () => { expect(isSale(mkOrder({ status: 'picking' }))).toBe(true) })
  it('POS con minúsculas en el prefijo no es POS', () => { expect(isPosOrder(mkOrder({ external_ref: 'pos-1' }))).toBe(false) })
})

describe('salesSummary/channelSplit — combinaciones', () => {
  it('solo POS: portal en cero', () => {
    const r = channelSplit([mkOrder({ external_ref: 'POS-1', total: 500 })])
    expect(r.portal.orders).toBe(0)
    expect(r.pos.orders).toBe(1)
  })
  it('ticket promedio con 2 ventas iguales', () => {
    const r = salesSummary([mkOrder({ id: '1', total: 400 }), mkOrder({ id: '2', total: 600 })])
    expect(r.avgTicket).toBe(500)
  })
})

describe('doctorActivity — todos sin doctor', () => {
  it('pedidos sin doctor_id no cuentan', () => {
    const r = doctorActivity([mkOrder({ id: '1', doctor_id: null }), mkOrder({ id: '2', doctor_id: null })])
    expect(r.active).toBe(0)
  })
})

describe('topDoctors — vacío', () => {
  it('sin pedidos devuelve lista vacía', () => {
    expect(topDoctors([], {})).toEqual([])
  })
})

describe('lineMix — solo profesional', () => {
  it('acumula todo en prof', () => {
    const orders = [mkOrder({ items: [mkItem({ product_id: 'p', qty: 3, unit_price: 900 })] })]
    const r = lineMix(orders, { p: mkProduct({ id: 'p', line: 'prof' }) })
    expect(r.prof).toEqual({ units: 3, revenue: 2700 })
    expect(r.cosm.units).toBe(0)
  })
})

describe('monthlySales — 12 meses', () => {
  it('devuelve 12 cubetas', () => { expect(monthlySales([], 12)).toHaveLength(12) })
})

describe('billingSummary — mezcla', () => {
  it('cfdiRate 0.5 con la mitad facturada', () => {
    const r = billingSummary([
      mkOrder({ id: '1', invoice_requested: true, payment_status: 'paid', total: 100 }),
      mkOrder({ id: '2', invoice_requested: false, payment_status: 'paid', total: 100 }),
    ])
    expect(r.cfdiRate).toBe(0.5)
    expect(r.paid).toBe(200)
  })
})

describe('stockByProduct — sin lotes', () => {
  it('devuelve un mapa vacío', () => { expect(stockByProduct([])).toEqual({}) })
})

describe('allocateFEFO — match exacto', () => {
  it('toma justo lo disponible sin faltante', () => {
    const r = allocateFEFO('p1', 10, [mkLot({ quantity: 10, expiry_date: '2030-01-01' })])
    expect(r.shortfall).toBe(0)
    expect(r.allocations[0].qty).toBe(10)
  })
})

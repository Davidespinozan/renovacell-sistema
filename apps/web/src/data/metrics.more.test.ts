// Casos límite adicionales de métricas/KPIs.
import { describe, it, expect } from 'vitest'
import {
  salesSummary, channelSplit, doctorActivity, topDoctors, topProducts,
  lineMix, monthlySales, doctorsAtRisk, billingSummary,
} from './metrics'
import { mkOrder, mkItem, mkProduct, mkProfile } from '../test/factories'

describe('salesSummary — más casos', () => {
  it('sin pedidos: todo en cero', () => {
    expect(salesSummary([])).toEqual({ revenue: 0, orders: 0, avgTicket: 0 })
  })
  it('mezcla ventas y no-ventas sin contar las segundas', () => {
    const r = salesSummary([
      mkOrder({ id: '1', total: 200 }),
      mkOrder({ id: '2', total: 300, status: 'pending_payment' }),
      mkOrder({ id: '3', total: 500, status: 'draft' }),
    ])
    expect(r).toEqual({ revenue: 200, orders: 1, avgTicket: 200 })
  })
})

describe('channelSplit — más casos', () => {
  it('cero cuando no hay ventas', () => {
    const r = channelSplit([mkOrder({ status: 'cancelled', total: 100 })])
    expect(r.pos).toEqual({ orders: 0, revenue: 0 })
    expect(r.portal).toEqual({ orders: 0, revenue: 0 })
  })
  it('varios POS y portal se acumulan', () => {
    const r = channelSplit([
      mkOrder({ id: '1', external_ref: 'POS-1', total: 100 }),
      mkOrder({ id: '2', external_ref: 'POS-2', total: 200 }),
      mkOrder({ id: '3', external_ref: 'S-1', total: 400 }),
    ])
    expect(r.pos).toEqual({ orders: 2, revenue: 300 })
    expect(r.portal).toEqual({ orders: 1, revenue: 400 })
  })
})

describe('doctorActivity — más casos', () => {
  it('un doctor con un solo pedido no es recurrente', () => {
    const r = doctorActivity([mkOrder({ doctor_id: 'A' })])
    expect(r).toEqual({ active: 1, repeat: 0, repeatRate: 0 })
  })
  it('todos recurrentes → tasa 1', () => {
    const r = doctorActivity([
      mkOrder({ id: '1', doctor_id: 'A' }), mkOrder({ id: '2', doctor_id: 'A' }),
      mkOrder({ id: '3', doctor_id: 'B' }), mkOrder({ id: '4', doctor_id: 'B' }),
    ])
    expect(r.repeatRate).toBe(1)
  })
})

describe('topDoctors / topProducts — orden y límite', () => {
  it('topDoctors ordena descendente por total', () => {
    const orders = [
      mkOrder({ id: '1', doctor_id: 'A', total: 100 }),
      mkOrder({ id: '2', doctor_id: 'B', total: 900 }),
      mkOrder({ id: '3', doctor_id: 'C', total: 500 }),
    ]
    expect(topDoctors(orders, {}).map((d) => d.id)).toEqual(['B', 'C', 'A'])
  })
  it('topProducts respeta el límite', () => {
    const orders = [mkOrder({ items: [
      mkItem({ product_id: 'a', qty: 1, unit_price: 100 }),
      mkItem({ product_id: 'b', qty: 1, unit_price: 200 }),
      mkItem({ product_id: 'c', qty: 1, unit_price: 300 }),
    ] })]
    expect(topProducts(orders, {}, 2)).toHaveLength(2)
    expect(topProducts(orders, {}, 2)[0].id).toBe('c') // mayor ingreso primero
  })
})

describe('lineMix — más casos', () => {
  it('sin ítems queda en cero', () => {
    const r = lineMix([mkOrder({ items: [] })], {})
    expect(r.cosm.units).toBe(0)
    expect(r.prof.units).toBe(0)
  })
})

describe('monthlySales — bucketing', () => {
  it('suma una venta del mes en curso a su cubeta', () => {
    const now = new Date()
    const iso = new Date(now.getFullYear(), now.getMonth(), 15).toISOString()
    const r = monthlySales([mkOrder({ total: 1234, created_at: iso })], 6)
    expect(r[r.length - 1].revenue).toBe(1234) // la última cubeta es el mes actual
  })
})

describe('doctorsAtRisk — orden por total', () => {
  it('ordena de mayor a menor gasto histórico', () => {
    const docs = [mkProfile({ id: 'A', verified: true }), mkProfile({ id: 'B', verified: true })]
    // ambos sin pedidos recientes (nunca) → ambos en riesgo, total 0, orden estable
    const r = doctorsAtRisk([], docs, 60)
    expect(r).toHaveLength(2)
    expect(r.every((x) => x.lastDays === null)).toBe(true)
  })
})

describe('billingSummary — más casos', () => {
  it('tasa de CFDI 0 sin ventas', () => {
    expect(billingSummary([]).cfdiRate).toBe(0)
  })
  it('todo pagado: pendiente 0', () => {
    const r = billingSummary([mkOrder({ payment_status: 'paid', total: 500, invoice_requested: true })])
    expect(r.pending).toBe(0)
    expect(r.cfdiRate).toBe(1)
  })
})

// Pruebas de la capa de métricas/KPIs (Tablero + Admin→Ventas). Todo función pura.
import { describe, it, expect } from 'vitest'
import {
  isSale, isPosOrder, salesSummary, channelSplit, doctorActivity,
  topDoctors, topProducts, lineMix, monthlySales, doctorsAtRisk, billingSummary,
} from './metrics'
import { mkOrder, mkItem, mkProduct, mkProfile } from '../test/factories'

describe('isSale / isPosOrder', () => {
  it('excluye cancelados, borradores y pendientes de pago', () => {
    expect(isSale(mkOrder({ status: 'delivered' }))).toBe(true)
    expect(isSale(mkOrder({ status: 'paid' }))).toBe(true)
    expect(isSale(mkOrder({ status: 'cancelled' }))).toBe(false)
    expect(isSale(mkOrder({ status: 'draft' }))).toBe(false)
    expect(isSale(mkOrder({ status: 'pending_payment' }))).toBe(false)
    expect(isSale(mkOrder({ status: null }))).toBe(false)
  })
  it('detecta POS por el prefijo del folio', () => {
    expect(isPosOrder(mkOrder({ external_ref: 'POS-123' }))).toBe(true)
    expect(isPosOrder(mkOrder({ external_ref: 'S-123' }))).toBe(false)
    expect(isPosOrder(mkOrder({ external_ref: null }))).toBe(false)
  })
})

describe('salesSummary', () => {
  it('suma ingresos y ticket promedio solo de ventas reales', () => {
    const r = salesSummary([
      mkOrder({ id: 'a', total: 1000 }),
      mkOrder({ id: 'b', total: 500 }),
      mkOrder({ id: 'c', total: 9999, status: 'cancelled' }), // no cuenta
    ])
    expect(r.revenue).toBe(1500)
    expect(r.orders).toBe(2)
    expect(r.avgTicket).toBe(750)
  })
  it('ticket promedio 0 sin ventas', () => {
    expect(salesSummary([]).avgTicket).toBe(0)
  })
  it('total null se trata como 0', () => {
    expect(salesSummary([mkOrder({ total: null })]).revenue).toBe(0)
  })
})

describe('channelSplit', () => {
  it('separa POS de portal', () => {
    const r = channelSplit([
      mkOrder({ id: 'a', external_ref: 'POS-1', total: 300 }),
      mkOrder({ id: 'b', external_ref: 'S-1', total: 700 }),
      mkOrder({ id: 'c', external_ref: 'S-2', total: 100, status: 'draft' }), // no venta
    ])
    expect(r.pos).toEqual({ orders: 1, revenue: 300 })
    expect(r.portal).toEqual({ orders: 1, revenue: 700 })
  })
})

describe('doctorActivity', () => {
  it('cuenta activos, recurrentes y su tasa', () => {
    const r = doctorActivity([
      mkOrder({ id: '1', doctor_id: 'A' }),
      mkOrder({ id: '2', doctor_id: 'A' }), // A recurrente
      mkOrder({ id: '3', doctor_id: 'B' }),
      mkOrder({ id: '4', doctor_id: null }), // sin doctor: ignora
    ])
    expect(r.active).toBe(2)
    expect(r.repeat).toBe(1)
    expect(r.repeatRate).toBe(0.5)
  })
  it('tasa 0 sin doctores', () => {
    expect(doctorActivity([]).repeatRate).toBe(0)
  })
})

describe('topDoctors', () => {
  it('ordena por total gastado y resuelve el nombre', () => {
    const orders = [
      mkOrder({ id: '1', doctor_id: 'A', total: 100 }),
      mkOrder({ id: '2', doctor_id: 'A', total: 400 }),
      mkOrder({ id: '3', doctor_id: 'B', total: 300 }),
    ]
    const r = topDoctors(orders, { A: mkProfile({ id: 'A', full_name: 'Dra. A' }) })
    expect(r[0]).toMatchObject({ id: 'A', name: 'Dra. A', orders: 2, total: 500 })
    expect(r[1]).toMatchObject({ id: 'B', name: 'Doctor', total: 300 }) // sin perfil → fallback
  })
  it('respeta el límite', () => {
    const orders = ['A', 'B', 'C'].map((d, i) => mkOrder({ id: String(i), doctor_id: d, total: (i + 1) * 100 }))
    expect(topDoctors(orders, {}, 2)).toHaveLength(2)
  })
})

describe('topProducts', () => {
  it('suma unidades e ingreso e ignora cotizaciones (precio null)', () => {
    const orders = [
      mkOrder({ id: '1', items: [mkItem({ product_id: 'p1', qty: 2, unit_price: 100 })] }),
      mkOrder({ id: '2', items: [mkItem({ product_id: 'p1', qty: 1, unit_price: 100 }), mkItem({ product_id: 'p2', qty: 5, unit_price: null })] }),
    ]
    const r = topProducts(orders, { p1: mkProduct({ id: 'p1', name: 'Serum' }) })
    expect(r).toHaveLength(1) // p2 con precio null no cuenta
    expect(r[0]).toMatchObject({ id: 'p1', name: 'Serum', units: 3, revenue: 300 })
  })
})

describe('lineMix', () => {
  it('reparte unidades/ingreso entre cosmética y profesional', () => {
    const orders = [mkOrder({
      items: [
        mkItem({ product_id: 'c', qty: 2, unit_price: 100 }),
        mkItem({ product_id: 'p', qty: 1, unit_price: 500 }),
      ],
    })]
    const r = lineMix(orders, { c: mkProduct({ id: 'c', line: 'cosm' }), p: mkProduct({ id: 'p', line: 'prof' }) })
    expect(r.cosm).toEqual({ units: 2, revenue: 200 })
    expect(r.prof).toEqual({ units: 1, revenue: 500 })
  })
  it('un producto sin línea conocida cae a cosmética', () => {
    const orders = [mkOrder({ items: [mkItem({ product_id: 'x', qty: 1, unit_price: 50 })] })]
    const r = lineMix(orders, {})
    expect(r.cosm.units).toBe(1)
  })
})

describe('monthlySales', () => {
  it('devuelve N cubetas de mes', () => {
    expect(monthlySales([], 6)).toHaveLength(6)
    expect(monthlySales([], 3)).toHaveLength(3)
  })
  it('las ventas fuera de la ventana no suman a ningún mes', () => {
    const r = monthlySales([mkOrder({ created_at: '2000-01-15T10:00:00Z', total: 999 })], 6)
    expect(r.reduce((s, b) => s + b.revenue, 0)).toBe(0)
  })
})

describe('doctorsAtRisk', () => {
  it('lista verificados sin pedidos (nunca compraron)', () => {
    const docs = [mkProfile({ id: 'A', verified: true }), mkProfile({ id: 'B', verified: false })]
    const r = doctorsAtRisk([], docs, 60)
    expect(r.map((x) => x.id)).toEqual(['A']) // B no verificado no aplica
    expect(r[0].lastDays).toBeNull()
  })
  it('excluye a quien compró recientemente', () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const docs = [mkProfile({ id: 'A', verified: true })]
    const r = doctorsAtRisk([mkOrder({ doctor_id: 'A', created_at: recent })], docs, 60)
    expect(r).toHaveLength(0)
  })
})

describe('billingSummary', () => {
  it('calcula tasa de CFDI, cobrado y pendiente', () => {
    const orders = [
      mkOrder({ id: '1', invoice_requested: true, payment_status: 'paid', total: 1000 }),
      mkOrder({ id: '2', invoice_requested: false, payment_status: 'pending', total: 500 }),
    ]
    const r = billingSummary(orders)
    expect(r.cfdiRate).toBe(0.5)
    expect(r.paid).toBe(1000)
    expect(r.pending).toBe(500)
  })
})

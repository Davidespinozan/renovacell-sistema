// Pruebas de finanzas (posición financiera + arqueo de caja). Función pura.
import { describe, it, expect } from 'vitest'
import { cuentasPorCobrar, cuentasPorPagar, gastosPorCategoria, efectivoEsperado } from './finanzas'
import { mkOrder } from '../../test/factories'
import type { Gasto } from '../store/gastosStore'
import type { PurchaseOrder } from '../store/comprasStore'

const gasto = (g: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', fecha: '2026-06-01', categoria: 'Renta', concepto: 'x', monto: 100,
  created_at: '2026-06-01T10:00:00Z', ...g,
})
const compra = (c: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'c1', product_id: 'p1', product_name: 'X', qty: 2, unit_cost: 300, kind: 'compra',
  supplier: 'Prov', status: 'pendiente', paid: false, created_at: '2026-06-01T10:00:00Z', ...c,
})

describe('cuentasPorCobrar', () => {
  it('cuenta pedidos de portal no pagados (contra pedido)', () => {
    const r = cuentasPorCobrar([
      mkOrder({ id: '1', external_ref: 'S-1', payment_status: 'pending', total: 1000, status: 'paid' }),
      mkOrder({ id: '2', external_ref: 'S-2', payment_status: 'paid', total: 500 }), // ya pagado
      mkOrder({ id: '3', external_ref: 'POS-1', payment_status: 'pending', total: 999 }), // POS se cobra al momento
      mkOrder({ id: '4', external_ref: 'S-3', payment_status: 'pending', total: 200, status: 'cancelled' }), // cancelado
    ])
    expect(r.count).toBe(1)
    expect(r.total).toBe(1000)
  })
})

describe('cuentasPorPagar', () => {
  it('suma compras a proveedor no pagadas, a su costo', () => {
    const r = cuentasPorPagar([
      compra({ id: 'a', qty: 2, unit_cost: 300, paid: false }),
      compra({ id: 'b', qty: 1, unit_cost: 1000, paid: true }), // pagada: no cuenta
    ])
    expect(r.count).toBe(1)
    expect(r.total).toBe(600)
  })
})

describe('gastosPorCategoria', () => {
  it('agrupa por categoría y ordena de mayor a menor', () => {
    const r = gastosPorCategoria([
      gasto({ categoria: 'Renta', monto: 12000 }),
      gasto({ categoria: 'Nómina', monto: 7000 }),
      gasto({ categoria: 'Nómina', monto: 7000 }),
    ])
    expect(r[0]).toEqual({ categoria: 'Nómina', monto: 14000 })
    expect(r[1]).toEqual({ categoria: 'Renta', monto: 12000 })
  })
})

describe('efectivoEsperado — arqueo POS', () => {
  it('suma solo ventas POS en efectivo del día', () => {
    const day = '2026-06-15'
    const r = efectivoEsperado([
      mkOrder({ id: '1', external_ref: 'POS-1', payment_method: 'efectivo', total: 300, created_at: `${day}T10:00:00Z` }),
      mkOrder({ id: '2', external_ref: 'POS-2', payment_method: 'tarjeta', total: 999, created_at: `${day}T11:00:00Z` }), // no efectivo
      mkOrder({ id: '3', external_ref: 'POS-3', payment_method: 'efectivo', total: 500, created_at: '2026-06-16T10:00:00Z' }), // otro día
    ], { day })
    expect(r).toBe(300)
  })
  it('filtra por evento cuando se indica', () => {
    const orders = [
      mkOrder({ id: '1', external_ref: 'POS-1', payment_method: 'efectivo', total: 400, shipping_meta: { event_id: 'ev1' } }),
      mkOrder({ id: '2', external_ref: 'POS-2', payment_method: 'efectivo', total: 100, shipping_meta: { event_id: 'ev2' } }),
    ]
    expect(efectivoEsperado(orders, { eventId: 'ev1' })).toBe(400)
  })
})

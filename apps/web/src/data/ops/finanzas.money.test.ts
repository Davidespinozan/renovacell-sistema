// W2 · Cobranza y CxC salen del LIBRO cuando hay libro: un pago parcial cuenta como
// parcial y un crédito autorizado sigue siendo deuda (no ingreso).
import { describe, it, expect } from 'vitest'
import { cobranza, cuentasPorCobrar, type MoneyIndex } from './finanzas'
import type { OrderMoney } from './money'
import { mkOrder } from '../../test/factories'

const dinero = (p: Partial<OrderMoney> & { order_id: string; total: number }): OrderMoney => ({
  external_ref: null, order_status: 'pending_payment', payment_status: 'pending',
  cobrado: 0, reembolsado: 0, cobrado_neto: 0, saldo: p.total, estado_pago: 'pending',
  sobrepago: false, reembolso_pendiente: 0, credito_autorizado: false, due_date: null,
  vencido: false, liberado: false, ...p,
})

describe('cobranza desde el libro', () => {
  it('un pago PARCIAL se cuenta parcial (no todo ni nada)', () => {
    const o = mkOrder({ id: '1', external_ref: 'S-1', total: 1000, payment_status: 'parcial' })
    const money: MoneyIndex = { '1': dinero({ order_id: '1', total: 1000, cobrado: 400, cobrado_neto: 400, saldo: 600, estado_pago: 'parcial' }) }
    const c = cobranza([o], [], money)
    expect(c.vendido).toBe(1000)
    expect(c.cobrado).toBe(400)
    expect(c.porCobrar).toBe(600)
  })
  it('reconcilia: vendido = cobrado + devuelto + por cobrar', () => {
    const o = mkOrder({ id: '1', external_ref: 'S-1', total: 1000, payment_status: 'paid' })
    const money: MoneyIndex = { '1': dinero({ order_id: '1', total: 1000, cobrado: 1000, reembolsado: 250, cobrado_neto: 750, saldo: 250, estado_pago: 'paid' }) }
    const c = cobranza([o], [], money)
    expect(c.cobrado + c.devuelto + c.porCobrar).toBe(c.vendido)
    expect(c.devuelto).toBe(250)
  })
  it('un crédito autorizado NO es dinero cobrado', () => {
    const o = mkOrder({ id: '1', external_ref: 'S-1', total: 1000, payment_status: 'pending' })
    const money: MoneyIndex = { '1': dinero({ order_id: '1', total: 1000, credito_autorizado: true, due_date: '2026-10-30', liberado: true }) }
    const c = cobranza([o], [], money)
    expect(c.cobrado).toBe(0)
    expect(c.porCobrar).toBe(1000)
  })
})

describe('cuentas por cobrar desde el libro', () => {
  const orders = [
    mkOrder({ id: '1', external_ref: 'S-1', total: 1000, payment_status: 'parcial' }),
    mkOrder({ id: '2', external_ref: 'S-2', total: 500, payment_status: 'pending' }),
  ]
  const money: MoneyIndex = {
    '1': dinero({ order_id: '1', total: 1000, cobrado: 600, cobrado_neto: 600, saldo: 400, estado_pago: 'parcial' }),
    '2': dinero({ order_id: '2', total: 500, credito_autorizado: true, due_date: '2026-09-20', vencido: true, liberado: true }),
  }
  it('la CxC es el SALDO, no el total del pedido', () => {
    const r = cuentasPorCobrar(orders, money)
    expect(r.total).toBe(900)
    expect(r.count).toBe(2)
  })
  it('separa la deuda a crédito y la ya vencida', () => {
    const r = cuentasPorCobrar(orders, money)
    expect(r.aCredito).toBe(500)
    expect(r.vencido).toBe(500)
  })
  it('sin libro se cae a payment_status (demo)', () => {
    const r = cuentasPorCobrar([mkOrder({ id: '9', external_ref: 'S-9', total: 300, payment_status: 'pending' })])
    expect(r).toEqual({ total: 300, count: 1, aCredito: 0, vencido: 0 })
  })
})

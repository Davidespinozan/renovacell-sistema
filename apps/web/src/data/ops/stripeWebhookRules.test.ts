// M-07 — el webhook de Stripe solo marca pagado si el estado es 'paid' y el IMPORTE coincide.
import { describe, it, expect } from 'vitest'
import { evaluarPago, montoEsperadoCentavos } from '../../../../../supabase/functions/stripe-webhook/rules'

const order = { total: 890, payment_status: 'pending' } // 890 MXN = 89000 centavos

describe('evaluarPago', () => {
  it('paid + importe correcto → marca pagado', () => {
    const r = evaluarPago({ payment_status: 'paid', amount_total: 89000, metadata: { order_id: 'o1' } }, order)
    expect(r).toEqual({ marcar: true, orderId: 'o1' })
  })
  it('payment_status != paid → NO marca', () => {
    expect(evaluarPago({ payment_status: 'unpaid', amount_total: 89000, metadata: { order_id: 'o1' } }, order))
      .toEqual({ marcar: false, reason: 'not_paid' })
  })
  it('importe distinto → NO marca (amount_mismatch)', () => {
    expect(evaluarPago({ payment_status: 'paid', amount_total: 100, metadata: { order_id: 'o1' } }, order))
      .toEqual({ marcar: false, reason: 'amount_mismatch' })
  })
  it('sin order_id → NO marca', () => {
    expect(evaluarPago({ payment_status: 'paid', amount_total: 89000, metadata: {} }, order))
      .toEqual({ marcar: false, reason: 'no_order_id' })
  })
  it('pedido inexistente → NO marca', () => {
    expect(evaluarPago({ payment_status: 'paid', amount_total: 89000, metadata: { order_id: 'o1' } }, null))
      .toEqual({ marcar: false, reason: 'order_not_found' })
  })
  it('montoEsperadoCentavos convierte pesos→centavos', () => {
    expect(montoEsperadoCentavos(890)).toBe(89000)
    expect(montoEsperadoCentavos(null)).toBe(0)
  })
})

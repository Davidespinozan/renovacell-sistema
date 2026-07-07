// Lógica de pedidos y gastos en modo MOCK (singleton compartido → aserta el ítem).
import { describe, it, expect } from 'vitest'
import { createOrder, payOrder, cancelOrder, getSnapshot } from './ordersStore'
import { addGasto, removeGasto, getSnapshot as gastosSnapshot } from './gastosStore'

const nuevoPedido = () => createOrder({
  lines: [{ product_id: 'p1', qty: 2, unit_price: 500 }],
  total: 1000, invoice_requested: false,
})

describe('ordersStore — ciclo de pago', () => {
  it('createOrder nace pendiente de pago', () => {
    const o = nuevoPedido()
    expect(o.status).toBe('pending_payment')
    expect(o.payment_status).toBe('pending')
    expect(getSnapshot().some((x) => x.id === o.id)).toBe(true)
  })

  it('payOrder marca pagado y pasa a "paid"', () => {
    const o = nuevoPedido()
    const r = payOrder(o.id, { method: 'tarjeta', ref: 'TR-1', actor: 'Portal del Doctor' })
    expect(r.ok).toBe(true)
    const got = getSnapshot().find((x) => x.id === o.id)
    expect(got?.payment_status).toBe('paid')
    expect(got?.status).toBe('paid')
  })

  it('no se puede pagar dos veces', () => {
    const o = nuevoPedido()
    payOrder(o.id, { method: 'tarjeta', ref: 'TR-2' })
    expect(payOrder(o.id, { method: 'tarjeta', ref: 'TR-3' }).ok).toBe(false)
  })

  it('cancelOrder cancela un pedido cancelable', () => {
    const o = nuevoPedido()
    const r = cancelOrder(o.id, 'Administración')
    expect(r.ok).toBe(true)
    expect(getSnapshot().find((x) => x.id === o.id)?.status).toBe('cancelled')
  })
})

describe('gastosStore', () => {
  it('addGasto lo registra', () => {
    const g = addGasto({ fecha: '2026-07-01', categoria: 'Marketing', concepto: 'Anuncios QA', monto: 1500 })
    expect(gastosSnapshot().some((x) => x.id === g.id && x.monto === 1500)).toBe(true)
  })
  it('removeGasto lo elimina', () => {
    const g = addGasto({ fecha: '2026-07-02', categoria: 'Renta', concepto: 'QA borrar', monto: 100 })
    removeGasto(g.id)
    expect(gastosSnapshot().some((x) => x.id === g.id)).toBe(false)
  })
})

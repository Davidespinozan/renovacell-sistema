// Lógica de pedidos y gastos en modo MOCK (singleton compartido → aserta el ítem).
import { describe, it, expect } from 'vitest'
import { createOrder, payOrder, cancelOrder, getSnapshot } from './ordersStore'
import { addGasto, removeGasto, getSnapshot as gastosSnapshot } from './gastosStore'

// W4: createOrder ya no devuelve el pedido antes de confirmarlo.
const nuevoPedido = async () => {
  const r = await createOrder({
    lines: [{ product_id: 'p1', qty: 2, unit_price: 500 }],
    total: 1000, invoice_requested: false,
  })
  if (!r.ok) throw new Error(r.error)
  return r.order
}

describe('ordersStore — ciclo de pago', () => {
  it('createOrder nace pendiente de pago', async () => {
    const o = await nuevoPedido()
    expect(o.status).toBe('pending_payment')
    expect(o.payment_status).toBe('pending')
    expect(getSnapshot().some((x) => x.id === o.id)).toBe(true)
  })

  it('payOrder marca pagado y pasa a "paid"', async () => {
    const o = await nuevoPedido()
    const r = payOrder(o.id, { method: 'tarjeta', ref: 'TR-1', actor: 'Portal del Doctor' })
    expect(r.ok).toBe(true)
    const got = getSnapshot().find((x) => x.id === o.id)
    expect(got?.payment_status).toBe('paid')
    expect(got?.status).toBe('paid')
  })

  it('no se puede pagar dos veces', async () => {
    const o = await nuevoPedido()
    payOrder(o.id, { method: 'tarjeta', ref: 'TR-2' })
    expect(payOrder(o.id, { method: 'tarjeta', ref: 'TR-3' }).ok).toBe(false)
  })

  it('cancelOrder cancela un pedido cancelable', async () => {
    const o = await nuevoPedido()
    const r = cancelOrder(o.id, 'Administración')
    expect(r.ok).toBe(true)
    expect(getSnapshot().find((x) => x.id === o.id)?.status).toBe('cancelled')
  })
})

// W4: un gasto solo "existe" cuando el store lo confirmó.
const gasto = async (p: ReturnType<typeof addGasto>) => {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.gasto
}

describe('gastosStore', () => {
  it('addGasto lo registra', async () => {
    const g = await gasto(addGasto({ fecha: '2026-07-01', categoria: 'Marketing', concepto: 'Anuncios QA', monto: 1500 }))
    expect(gastosSnapshot().some((x) => x.id === g.id && x.monto === 1500)).toBe(true)
  })
  it('removeGasto lo elimina', async () => {
    const g = await gasto(addGasto({ fecha: '2026-07-02', categoria: 'Renta', concepto: 'QA borrar', monto: 100 }))
    await removeGasto(g.id)
    expect(gastosSnapshot().some((x) => x.id === g.id)).toBe(false)
  })
})

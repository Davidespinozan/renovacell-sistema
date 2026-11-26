import { describe, it, expect } from 'vitest'
import { pedidosPorConfirmar, pedidosPorCobrarSinConfirmar } from './porConfirmar'
import type { OrderMoney } from './money'

const m = (liberado: boolean) => ({ liberado } as OrderMoney)
const o = (id: string, status: string, payment_status: string, total = 100) => ({ id, status, payment_status, total })

describe('pedidos por confirmar (dueño, 26 nov 2026)', () => {
  it('sin pagar y sin liberar = por confirmar; con crédito/al recibir o ya entregado = falta cobrar; pagados y cancelados fuera', () => {
    const orders = [o('a', 'pending_payment', 'pending'), o('b', 'pending_payment', 'pending'), o('c', 'delivered', 'pending'), o('d', 'paid', 'paid'), o('e', 'cancelled', 'pending'), o('f', 'pending_payment', 'parcial')]
    const byOrder = { a: m(false), b: m(true), c: m(false), f: m(false) }
    expect(pedidosPorConfirmar(orders, byOrder).map((x) => x.id)).toEqual(['a', 'f'])
    expect(pedidosPorCobrarSinConfirmar(orders, byOrder).map((x) => x.id)).toEqual(['b', 'c'])
  })
})

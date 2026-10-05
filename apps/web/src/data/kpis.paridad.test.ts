// W5 · PARIDAD con el servidor. El escenario de supabase/tests/db/tests/w5_01_kpis.sql
// (10 pedidos: borde de mes, pagos parciales, crédito, devolución, cancelación, sin costo,
// mezcla, sin surtir, borrador, POS) se reconstruye aquí tal cual y `data/kpis.ts` debe
// dar EXACTAMENTE los dorados que la base verificó con los comandos reales.
import { describe, it, expect } from 'vitest'
import { calcularVentas, calcularPorCobrar, calcularResultado, type MoneyIndex } from './kpis'
import type { OrderWithItems } from './hooks/useOrders'
import type { OrderMoney } from './ops/money'
import { periodoMes } from './periodo'

import sql from '../../../../supabase/tests/db/tests/w5_01_kpis.sql?raw'
const gold = JSON.parse(sql.slice(sql.indexOf('$gold$') + 6, sql.lastIndexOf('$gold$'))) as Record<string, Record<string, number | boolean | null>>

// Meses A (ago-2026) y B (sep-2026); "hoy" = C (oct-2026). Instantes en hora de Mazatlán (UTC-7).
const A = periodoMes('2026-08'), B = periodoMes('2026-09')
const mz = (dia: string, hora = '09:00') => `${dia}T${hora}:00-07:00`
const P1 = 'p1', P2 = 'p2' // p2 = producto SIN costo
const item = (order_id: string, product_id: string, qty: number, unit_price: number) =>
  ({ id: `${order_id}-${product_id}`, order_id, product_id, lot_id: null, qty, unit_price, created_at: mz('2026-08-01') })
const pedido = (id: string, created_at: string, lineas: [string, number, number][], over: Partial<OrderWithItems> = {}): OrderWithItems => ({
  id, external_ref: id, doctor_id: 'doc', currency: 'MXN', status: 'paid', payment_method: 'transferencia', payment_ref: null,
  payment_status: 'pending', stripe_payment_id: null, invoice_requested: false, invoice_meta: null, shipping_meta: null, created_at,
  total: lineas.reduce((s, [, q, p]) => s + q * p, 0), items: lineas.map(([p, q, u]) => item(id, p, q, u)), ...over,
})
const orders: OrderWithItems[] = [
  pedido('O1', mz('2026-08-31', '23:30'), [[P1, 2, 100]]),
  pedido('O2', mz('2026-08-10'), [[P1, 3, 100]]),
  pedido('O3', mz('2026-08-15', '12:00'), [[P1, 1, 100]], { status: 'delivered' }),
  pedido('O4', mz('2026-08-16'), [[P1, 1, 100]], { status: 'cancelled' }),
  pedido('O5', mz('2026-08-18'), [[P1, 2, 100]]),
  pedido('O6', mz('2026-08-20'), [[P2, 1, 200]]),
  pedido('O7', mz('2026-08-21'), [[P1, 1, 100], [P2, 1, 200]]),
  pedido('O8', mz('2026-08-22'), [[P1, 4, 100]]),
  pedido('O9', '2026-09-01T07:00:00Z', [[P1, 1, 100]]),
  pedido('O10', mz('2026-08-06'), [[P1, 9, 100]], { status: 'draft' }),
  pedido('OP', '2025-01-15T18:00:00Z', [[P1, 1, 100]], { external_ref: 'POS-W5-1' }),
]
// El libro (payment_entries), por fecha contable.
const entries = [
  { order_id: 'O1', direction: 'in' as const, amount: 200, value_date: '2026-09-04' },
  { order_id: 'O2', direction: 'in' as const, amount: 100, value_date: '2026-08-12' },
  { order_id: 'O2', direction: 'in' as const, amount: 50, value_date: '2026-08-20' },
  { order_id: 'O3', direction: 'in' as const, amount: 100, value_date: '2026-08-15' },
  { order_id: 'O3', direction: 'out' as const, amount: 100, value_date: '2026-09-02' },
  { order_id: 'O4', direction: 'in' as const, amount: 100, value_date: '2026-08-16' },
  { order_id: 'O6', direction: 'in' as const, amount: 200, value_date: '2026-08-20' },
  { order_id: 'O7', direction: 'in' as const, amount: 300, value_date: '2026-08-21' },
  { order_id: 'O8', direction: 'in' as const, amount: 400, value_date: '2026-08-22' },
  { order_id: 'O9', direction: 'in' as const, amount: 100, value_date: '2026-09-01' },
]
// v_order_money (lo que el servidor deriva del libro).
const dinero = (order_id: string, total: number, cobrado = 0, reembolsado = 0, credito = false): OrderMoney => ({
  order_id, external_ref: order_id, order_status: null, payment_status: null, total, cobrado, reembolsado,
  cobrado_neto: cobrado - reembolsado, saldo: total - (cobrado - reembolsado),
  estado_pago: 'pending', sobrepago: false, reembolso_pendiente: 0, credito_autorizado: credito, due_date: null, vencido: false, liberado: false,
})
const money: MoneyIndex = {
  O1: dinero('O1', 200, 200), O2: dinero('O2', 300, 150, 0, true), O3: dinero('O3', 100, 100, 100), O4: dinero('O4', 100, 100),
  O5: dinero('O5', 200, 0, 0, true), O6: dinero('O6', 200, 200), O7: dinero('O7', 300, 300), O8: dinero('O8', 400, 400),
  O9: dinero('O9', 100, 100), O10: dinero('O10', 900), OP: dinero('OP', 100),
}
// El kardex: salidas por surtido HOY (mes C) con costo congelado (p1 = 40, p2 = NULL); O3 regresa por devolución.
const HOY = mz('2026-10-05')
const mov = (id: string, order_id: string, change: number, reason: string, unit_cost: number | null) =>
  ({ id, lot_id: 'l', change, reason, reference: order_id, order_id, created_at: HOY, unit_cost })
const movements = [
  mov('m1', 'O1', -2, 'surtido', 40), mov('m2', 'O2', -3, 'surtido', 40), mov('m3', 'O3', -1, 'surtido', 40),
  mov('m3b', 'O3', 1, 'devolucion', 40), mov('m5', 'O5', -2, 'surtido', 40), mov('m6', 'O6', -1, 'surtido', null),
  mov('m7a', 'O7', -1, 'surtido', 40), mov('m7b', 'O7', -1, 'surtido', null), mov('m9', 'O9', -1, 'surtido', 40),
]
const refunds = [{ order_id: 'O3', monto: 100 }]
const gastos = [{ fecha: '2026-09-07', monto: 10 }]

describe('data/kpis.ts ⇔ dorados de w5_01_kpis.sql', () => {
  it('ventas y cobranza del mes A', () => {
    expect(calcularVentas({ orders, entries, money }, A)).toMatchObject(gold.ventasA)
  })
  it('ventas y cobranza del mes B (pedido de A pagado en B; devolución pagada en B)', () => {
    expect(calcularVentas({ orders, entries, money }, B)).toMatchObject(gold.ventasB)
  })
  it('por cobrar: posición a hoy (crédito sigue siendo deuda; POS fuera)', () => {
    expect(calcularPorCobrar(orders, money)).toMatchObject(gold.porCobrar)
  })
  it('resultado del mes A: costo incompleto ⇒ utilidad y margen null', () => {
    expect(calcularResultado({ orders, refunds, movements, gastos }, A)).toMatchObject(gold.resultadoA)
  })
  it('resultado del mes B: costo completo ⇒ utilidad conocida', () => {
    expect(calcularResultado({ orders, refunds, movements, gastos }, B)).toMatchObject(gold.resultadoB)
  })
  it('borde de mes: el pedido de las 23:30 del 31-ago es de agosto, no de septiembre', () => {
    expect(calcularVentas({ orders, entries, money }, { desde: '2026-08-31', hasta: '2026-08-31' }).ventas).toBe(200)
    expect(calcularVentas({ orders, entries, money }, { desde: '2026-09-01', hasta: '2026-09-01' }).ventas).toBe(100)
  })
  it('venta cobrada sin surtir: utilidad null, no margen 100%', () => {
    const r = calcularResultado({ orders, refunds, movements, gastos }, { desde: '2026-08-22', hasta: '2026-08-22' })
    expect(r).toMatchObject({ unidades_sin_surtir: 4, cobertura_pct: 0, costo_confiable: false, utilidad_bruta: null })
  })
  it('merma sin costo: la utilidad neta es null; la bruta no se contamina', () => {
    const r = calcularResultado({ orders, refunds, movements: [...movements, mov('x', '', -1, 'merma', null)], gastos }, periodoMes('2026-10'))
    expect(r).toMatchObject({ merma_unidades_sin_costo: 1, utilidad_neta_confiable: false, utilidad_neta: null, utilidad_bruta: 0 })
  })
})

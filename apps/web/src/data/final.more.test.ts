// Cierre de cobertura: casos distintos de finanzas, métricas, roles y formato.
import { describe, it, expect } from 'vitest'
import { gastosPorCategoria, cuentasPorPagar, efectivoEsperado } from './ops/finanzas'
import { topProducts, monthlySales, doctorsAtRisk } from './metrics'
import { getRole, getNav } from '../app/roles'
import { initials, timeAgo, money } from '../lib/format'
import { mkOrder, mkItem, mkProfile } from '../test/factories'
import type { PurchaseOrder } from './store/comprasStore'

const compra = (c: Partial<PurchaseOrder>): PurchaseOrder => ({
  id: 'c', product_id: 'p', product_name: 'X', qty: 1, unit_cost: 100, kind: 'compra',
  supplier: null, status: 'pendiente', paid: false, created_at: '', ...c,
})

describe('gastosPorCategoria — una categoría', () => {
  it('agrupa varios gastos de la misma categoría', () => {
    const r = gastosPorCategoria([
      { id: '1', fecha: '', categoria: 'Renta', concepto: 'a', monto: 100, created_at: '' } as never,
      { id: '2', fecha: '', categoria: 'Renta', concepto: 'b', monto: 50, created_at: '' } as never,
    ])
    expect(r).toEqual([{ categoria: 'Renta', monto: 150 }])
  })
})

describe('cuentasPorPagar — mezcla', () => {
  it('solo cuenta compras no pagadas', () => {
    const r = cuentasPorPagar([
      compra({ id: 'a', qty: 2, unit_cost: 100, paid: false }),
      compra({ id: 'b', qty: 1, unit_cost: 999, paid: true }),
    ])
    expect(r).toEqual({ total: 200, count: 1 })
  })
  it('ignora reabastecimientos internos (kind != compra)', () => {
    const r = cuentasPorPagar([compra({ id: 'x', kind: 'traspaso' as never, paid: false, qty: 5, unit_cost: 100 })])
    expect(r.count).toBe(0)
  })
})

describe('efectivoEsperado — tarjeta excluida', () => {
  it('no suma ventas con tarjeta', () => {
    const r = efectivoEsperado([mkOrder({ external_ref: 'POS-1', payment_method: 'tarjeta', total: 999 })], {})
    expect(r).toBe(0)
  })
})

describe('topProducts — nombre por defecto', () => {
  it('sin catálogo usa "Producto"', () => {
    const orders = [mkOrder({ items: [mkItem({ product_id: 'p', qty: 1, unit_price: 100 })] })]
    expect(topProducts(orders, {})[0].name).toBe('Producto')
  })
})

describe('monthlySales — etiqueta de mes', () => {
  it('cada cubeta trae etiqueta y clave', () => {
    const r = monthlySales([], 3)
    expect(r.every((b) => typeof b.label === 'string' && b.key.includes('-'))).toBe(true)
  })
})

describe('doctorsAtRisk — excluye recientes', () => {
  it('un doctor que compró ayer no está en riesgo', () => {
    const ayer = new Date(Date.now() - 86_400_000).toISOString()
    const r = doctorsAtRisk([mkOrder({ doctor_id: 'A', created_at: ayer })], [mkProfile({ id: 'A', verified: true })], 60)
    expect(r).toHaveLength(0)
  })
})

describe('getNav — el doctor no ve la vista común', () => {
  it('la navegación del doctor son sus módulos del portal', () => {
    const nav = getNav(getRole('doctor')).map((s) => s.key)
    expect(nav).toContain('catalogo')
  })
})

describe('formato — cierres', () => {
  it('initials de una sola letra', () => { expect(initials('X')).toBe('X') })
  it('timeAgo ahora mismo', () => { expect(timeAgo(new Date().toISOString())).toBe('ahora') })
  it('money negativo grande', () => { expect(money(-1_000_000)).toContain('1,000,000') })
})

// CANAL DE VENTA · sale de quién capturó el pedido (dato del servidor), no de la primera letra del folio.
import { describe, it, expect } from 'vitest'
import { canalDeVenta, ventasPorCanal } from './metrics'
import type { OrderWithItems } from './hooks/useOrders'

const o = (external_ref: string, meta: Record<string, unknown>, doctor_id: string | null = null, total = 100) =>
  ({ id: external_ref, external_ref, shipping_meta: meta, doctor_id, total, status: 'paid', items: [] }) as unknown as OrderWithItems

describe('canalDeVenta', () => {
  it('vendedor, Dirección, portal, caja y evento', () => {
    expect(canalDeVenta(o('S247449', { placed_by: 'Alejandra Cázarez (Ventas)' }))).toBe('vendedor')
    expect(canalDeVenta(o('S220936', { placed_by: 'Administración' }))).toBe('direccion')
    expect(canalDeVenta(o('S1', { placed_by: 'Pedido directo del portal' }, 'doc-1'))).toBe('portal')
    expect(canalDeVenta(o('S2', { placed_by: 'Checkout canónico (CC-6)' }, 'doc-1'))).toBe('portal')
    expect(canalDeVenta(o('POS-ABC12', { channel: 'pos' }))).toBe('mostrador')
    expect(canalDeVenta(o('POS-ABC13', { channel: 'pos', event_id: 'ev-1' }))).toBe('evento')
  })
  it('un pedido de vendedor con folio «S…» ya no se cuenta como portal', () => {
    expect(canalDeVenta(o('S216066', { placed_by: 'Roberto Ibarra (Ventas)' }))).not.toBe('portal')
  })
  it('históricos sin capturista: con cuenta de doctor = portal; sin ella = personal', () => {
    expect(canalDeVenta(o('S9', {}, 'doc-1'))).toBe('portal')
    expect(canalDeVenta(o('S8', {}))).toBe('vendedor')
  })
  it('suma por canal', () => {
    const r = ventasPorCanal([o('S1', { placed_by: 'Ana (Ventas)' }, null, 300), o('POS-1', { channel: 'pos' }, null, 50), o('S2', { placed_by: 'Pedido directo del portal' }, 'd', 20)])
    expect(r.vendedor).toEqual({ orders: 1, revenue: 300 }); expect(r.mostrador).toEqual({ orders: 1, revenue: 50 }); expect(r.portal).toEqual({ orders: 1, revenue: 20 })
  })
})

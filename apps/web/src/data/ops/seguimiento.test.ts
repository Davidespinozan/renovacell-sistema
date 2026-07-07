// Pruebas del diagnóstico de envíos: "pendiente de surtir" y "atorado".
import { describe, it, expect } from 'vitest'
import { isSurtible, diagnoseShipment } from './seguimiento'
import { mkOrder, mkShipment } from '../../test/factories'

describe('isSurtible — Almacén solo prepara lo cobrado', () => {
  it('pagado y aún no empacado = surtible', () => {
    expect(isSurtible(mkOrder({ payment_status: 'paid', status: 'paid' }))).toBe(true)
    expect(isSurtible(mkOrder({ payment_status: 'paid', status: 'picking' }))).toBe(true)
  })
  it('sin pagar NO es surtible (el doctor paga primero)', () => {
    expect(isSurtible(mkOrder({ payment_status: 'pending', status: 'paid' }))).toBe(false)
  })
  it('ya empacado/enviado/entregado/cancelado no es surtible', () => {
    ;(['packed', 'shipped', 'delivered', 'fulfilled', 'cancelled'] as const).forEach((st) =>
      expect(isSurtible(mkOrder({ payment_status: 'paid', status: st }))).toBe(false))
  })
})

describe('diagnoseShipment', () => {
  it('empacado sin envío asignado = atorado (surtido sin salir)', () => {
    const d = diagnoseShipment(mkOrder({ status: 'packed' }), undefined)
    expect(d.stuck).toBe(true)
    expect(d.reason).toContain('Surtido sin salir')
  })
  it('entregado no está atorado', () => {
    const d = diagnoseShipment(mkOrder({ status: 'delivered' }), mkShipment({ status: 'delivered' }))
    expect(d.stuck).toBe(false)
    expect(d.statusLabel).toBe('Entregado')
  })
  it('envío con fecha estimada vencida y sin entregar = atorado', () => {
    const overdue = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const d = diagnoseShipment(mkOrder({ status: 'shipped' }), mkShipment({ status: 'out_for_delivery', estimated_delivery_at: overdue }))
    expect(d.stuck).toBe(true)
    expect(d.statusPill).toBe('p-dang')
    expect(d.reason).toContain('vencida')
  })
  it('en reparto dentro de fecha = en curso, no atorado', () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const d = diagnoseShipment(mkOrder({ status: 'shipped' }), mkShipment({ status: 'out_for_delivery', estimated_delivery_at: future }))
    expect(d.stuck).toBe(false)
    expect(d.statusLabel).toBe('En reparto')
  })
})

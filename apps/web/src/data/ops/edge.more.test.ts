// Casos límite variados: diagnóstico de envíos por estatus + estatus de pedido.
import { describe, it, expect } from 'vitest'
import { diagnoseShipment, isSurtible } from './seguimiento'
import { statusView } from '../../screens/doctor/orderStatus'
import { mkOrder, mkShipment } from '../../test/factories'

describe('diagnoseShipment — por estatus de envío', () => {
  it('asignado a chofer = advertencia, no atorado', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const d = diagnoseShipment(mkOrder({ status: 'shipped' }), mkShipment({ status: 'assigned', estimated_delivery_at: future }))
    expect(d.statusLabel).toBe('Asignado a chofer')
    expect(d.stuck).toBe(false)
  })
  it('en tránsito muestra "En camino"', () => {
    const d = diagnoseShipment(mkOrder({ status: 'shipped' }), mkShipment({ status: 'in_transit', estimated_delivery_at: null }))
    expect(d.statusLabel).toBe('En camino')
  })
  it('sin fecha estimada no marca vencido', () => {
    const d = diagnoseShipment(mkOrder({ status: 'shipped' }), mkShipment({ status: 'out_for_delivery', estimated_delivery_at: null }))
    expect(d.stuck).toBe(false)
  })
})

describe('isSurtible — más casos', () => {
  it('pagado y en surtido (picking) sigue siendo surtible', () => {
    expect(isSurtible(mkOrder({ payment_status: 'paid', status: 'picking' }))).toBe(true)
  })
  it('estatus null no es surtible sin pago', () => {
    expect(isSurtible(mkOrder({ payment_status: 'pending', status: null }))).toBe(false)
  })
})

describe('statusView — estatus intermedios', () => {
  it('draft y picking mapean a su paso', () => {
    expect(statusView('draft')).toMatchObject({ label: 'Borrador', step: 0 })
    expect(statusView('picking')).toMatchObject({ label: 'En surtido', step: 1 })
  })
  it('cancelado tiene su etiqueta', () => {
    expect(statusView('cancelled').label).toBe('Cancelado')
  })
})

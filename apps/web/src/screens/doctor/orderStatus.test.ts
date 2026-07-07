// Pruebas del mapeo de estatus de pedido (etiqueta, pill y paso del tracking).
import { describe, it, expect } from 'vitest'
import { statusView, isPast, TRACK_STEPS } from './orderStatus'

describe('statusView', () => {
  it('mapea cada estatus a su paso del tracking', () => {
    expect(statusView('pending_payment')).toMatchObject({ label: 'Pendiente de pago', step: 0 })
    expect(statusView('paid')).toMatchObject({ label: 'Pagado', step: 1 })
    expect(statusView('packed')).toMatchObject({ label: 'Empacado', step: 2 })
    expect(statusView('shipped')).toMatchObject({ label: 'En camino', step: 3 })
    expect(statusView('delivered')).toMatchObject({ label: 'Entregado', pill: 'p-ok', step: 4 })
  })
  it('fulfilled cuenta como entregado', () => {
    expect(statusView('fulfilled').step).toBe(4)
  })
  it('estatus desconocido/null = guion', () => {
    expect(statusView(null).label).toBe('—')
  })
  it('el paso nunca excede los pasos del tracking', () => {
    ;(['draft', 'pending_payment', 'paid', 'picking', 'packed', 'shipped', 'delivered', 'fulfilled', 'cancelled', null] as const)
      .forEach((s) => expect(statusView(s).step).toBeLessThan(TRACK_STEPS.length))
  })
})

describe('isPast', () => {
  it('histórico = entregado/fulfilled/cancelado', () => {
    expect(isPast('delivered')).toBe(true)
    expect(isPast('fulfilled')).toBe(true)
    expect(isPast('cancelled')).toBe(true)
  })
  it('en curso NO es histórico', () => {
    expect(isPast('paid')).toBe(false)
    expect(isPast('packed')).toBe(false)
    expect(isPast('pending_payment')).toBe(false)
    expect(isPast(null)).toBe(false)
  })
})

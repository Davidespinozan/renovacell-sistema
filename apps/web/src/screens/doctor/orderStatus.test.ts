// Pruebas del mapeo de estatus de pedido (etiqueta, pill y paso del tracking).
import { describe, it, expect } from 'vitest'
import { statusView, isPast, seSurteSinPago, TRACK_STEPS } from './orderStatus'

describe('statusView', () => {
  it('mapea cada estatus a su paso del tracking', () => {
    // UN SOLO IDIOMA (27 nov 2026): Por confirmar → En almacén → En camino → Entregado
    expect(statusView('pending_payment')).toMatchObject({ label: 'Por confirmar', step: 0 })
    expect(statusView('paid')).toMatchObject({ label: 'En almacén', step: 1 })
    expect(statusView('packed')).toMatchObject({ label: 'En almacén', step: 1 })
    expect(statusView('shipped')).toMatchObject({ label: 'En camino', step: 2 })
    expect(statusView('delivered')).toMatchObject({ label: 'Entregado', pill: 'p-ok', step: 3 })
  })
  it('fulfilled cuenta como entregado', () => {
    expect(statusView('fulfilled').step).toBe(3)
  })
  it('sin pagar pero ya surtible (crédito o paga al recibir) está en almacén, no «por confirmar»', () => {
    expect(statusView('pending_payment', { liberado: true })).toMatchObject({ label: 'En almacén', step: 1 })
    expect(seSurteSinPago({ payment_method: 'credito' })).toBe(true)
    expect(seSurteSinPago({ payment_method: 'contra_entrega' })).toBe(true)
    expect(seSurteSinPago({ payment_method: 'por_cobrar' })).toBe(false)
    expect(seSurteSinPago({ payment_method: null })).toBe(false)
  })
  it('quien recoge ve «Listo para recoger» en el paso de salida', () => {
    expect(statusView('shipped', { recoge: true })).toMatchObject({ label: 'Listo para recoger', step: 2 })
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

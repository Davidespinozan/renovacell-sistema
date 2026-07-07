// Cierre: matriz de cancelabilidad de pedidos.
import { describe, it, expect } from 'vitest'
import { isCancelable } from './ordersStore'

describe('isCancelable — matriz completa', () => {
  it('cancelable hasta antes de salir', () => {
    expect(isCancelable('draft')).toBe(true)
    expect(isCancelable('paid')).toBe(true)
    expect(isCancelable('packed')).toBe(true)
  })
  it('no cancelable una vez enviado', () => {
    expect(isCancelable('shipped')).toBe(false)
  })
  it('no cancelable entregado ni cancelado', () => {
    expect(isCancelable('delivered')).toBe(false)
    expect(isCancelable('cancelled')).toBe(false)
  })
  it('estatus nulo no es cancelable', () => {
    expect(isCancelable(null)).toBe(false)
  })
})

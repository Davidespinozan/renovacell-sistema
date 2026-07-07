// Pruebas de helpers puros de los stores (importar en modo mock no hace red).
import { describe, it, expect } from 'vitest'
import { isCancelable } from './ordersStore'
import { suggestCompanyEmail } from './teamStore'

describe('isCancelable — un pedido se puede cancelar hasta antes de salir', () => {
  it('permite cancelar mientras no se haya enviado/entregado', () => {
    ;['draft', 'pending_payment', 'paid', 'picking', 'packed'].forEach((s) =>
      expect(isCancelable(s)).toBe(true))
  })
  it('NO permite cancelar enviado/entregado/cancelado', () => {
    ;['shipped', 'delivered', 'fulfilled', 'cancelled'].forEach((s) =>
      expect(isCancelable(s)).toBe(false))
    expect(isCancelable(null)).toBe(false)
  })
})

describe('suggestCompanyEmail — correo de empresa sugerido', () => {
  it('usa nombre.apellido con el dominio de la empresa', () => {
    expect(suggestCompanyEmail('Claudia Dirección')).toBe('claudia.direccion@renovacell.mx')
  })
  it('con un solo nombre usa solo ese', () => {
    expect(suggestCompanyEmail('Alberto')).toBe('alberto@renovacell.mx')
  })
  it('quita acentos y toma primero y último', () => {
    expect(suggestCompanyEmail('José Antonio Gallardo')).toBe('jose.gallardo@renovacell.mx')
  })
  it('nombre vacío devuelve cadena vacía', () => {
    expect(suggestCompanyEmail('   ')).toBe('')
  })
})

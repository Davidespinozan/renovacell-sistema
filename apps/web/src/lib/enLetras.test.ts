import { describe, it, expect } from 'vitest'
import { montoEnLetras } from './enLetras'

describe('montoEnLetras', () => {
  it('singular / plural del peso', () => {
    expect(montoEnLetras(1)).toBe('UN PESO 00/100 M.N.')
    expect(montoEnLetras(2)).toBe('DOS PESOS 00/100 M.N.')
    expect(montoEnLetras(0)).toBe('CERO PESOS 00/100 M.N.')
  })
  it('centavos', () => {
    expect(montoEnLetras(21.5)).toBe('VEINTIÚN PESOS 50/100 M.N.')
    expect(montoEnLetras(1200)).toBe('MIL DOSCIENTOS PESOS 00/100 M.N.')
    expect(montoEnLetras(1234.56)).toBe('MIL DOSCIENTOS TREINTA Y CUATRO PESOS 56/100 M.N.')
  })
  it('apócope y centenas', () => {
    expect(montoEnLetras(100)).toBe('CIEN PESOS 00/100 M.N.')
    expect(montoEnLetras(31)).toBe('TREINTA Y UN PESOS 00/100 M.N.')
    expect(montoEnLetras(215)).toBe('DOSCIENTOS QUINCE PESOS 00/100 M.N.')
  })
  it('miles y millones', () => {
    expect(montoEnLetras(2100)).toBe('DOS MIL CIEN PESOS 00/100 M.N.')
    expect(montoEnLetras(1000000)).toBe('UN MILLÓN PESOS 00/100 M.N.')
    expect(montoEnLetras(21000)).toBe('VEINTIÚN MIL PESOS 00/100 M.N.')
  })
})
import { describe, it, expect } from 'vitest'
import { puedeStryvCare, CAPABILITIES } from './roles'

describe('STRYV Care · quién lo abre (26 nov 2026)', () => {
  it('Dirección siempre; Almacén solo con la capacidad stryv_care; el doctor nunca', () => {
    expect(puedeStryvCare('admin')).toBe(true)
    expect(puedeStryvCare('warehouse', ['eventos', 'diseno'])).toBe(false)
    expect(puedeStryvCare('warehouse', ['eventos', 'stryv_care'])).toBe(true)
    expect(puedeStryvCare('doctor', ['stryv_care'])).toBe(false)
    expect(puedeStryvCare(null, ['stryv_care'])).toBe(false)
  })
  it('la capacidad se puede asignar desde Equipo', () => {
    expect(CAPABILITIES.some((c) => c.key === 'stryv_care')).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { decideVerification, nameSimilarity, isMedicalProfession, simulateSep } from './decide'

describe('verificación · motor de decisión', () => {
  it('nombre coincide pese a acentos y orden', () => {
    expect(nameSimilarity('Dr. José Ramírez Soto', 'JOSE RAMIREZ SOTO')).toBeGreaterThanOrEqual(0.9)
    expect(nameSimilarity('Ana López', 'Carlos Pérez')).toBeLessThan(0.5)
  })

  it('detecta profesión médica', () => {
    expect(isMedicalProfession('Médico Cirujano')).toBe(true)
    expect(isMedicalProfession('Dermatología')).toBe(true)
    expect(isMedicalProfession('Licenciatura en Administración')).toBe(false)
  })

  it('AUTO: cédula existe, médico y nombre coincide', () => {
    const d = decideVerification('Dra. Laura Méndez', { found: true, name: 'Laura Mendez', profession: 'Médico Cirujano' })
    expect(d.decision).toBe('auto')
    expect(d.isMedical).toBe(true)
    expect(d.score).toBeGreaterThanOrEqual(85)
  })

  it('REVISIÓN: existe pero la profesión no es médica', () => {
    const d = decideVerification('Laura Méndez', { found: true, name: 'Laura Méndez', profession: 'Licenciatura en Administración' })
    expect(d.decision).toBe('review')
    expect(d.isMedical).toBe(false)
  })

  it('RECHAZO: la cédula no existe en el registro', () => {
    const d = decideVerification('Laura Méndez', { found: false })
    expect(d.decision).toBe('reject')
    expect(d.score).toBe(0)
  })

  it('RECHAZO: existe pero el nombre no coincide (posible cédula ajena)', () => {
    const d = decideVerification('Pedro Otro', { found: true, name: 'Laura Méndez', profession: 'Médico Cirujano' })
    expect(d.decision).toBe('reject')
  })

  it('simulador SEP cubre las tres ramas por el último dígito', () => {
    expect(simulateSep('1234560', 'X').found).toBe(false) // termina en 0 → no existe
    expect(isMedicalProfession(simulateSep('1234569', 'X').profession)).toBe(false) // termina en 9 → no médico
    expect(isMedicalProfession(simulateSep('1234561', 'X').profession)).toBe(true) // resto → médico
  })
})

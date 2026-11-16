// FOTOS DE CLIENTES (15 nov 2026) · iniciales y color estable por cliente en la lista de conversaciones
import { describe, expect, it } from 'vitest'
import { inicialesDe } from './Asesorias'
import { avatarColor } from '../../lib/format'

describe('iniciales del cliente', () => {
  it('dos iniciales, sin «Dr./Dra./Clínica»; un número sin nombre lleva #', () => {
    expect(inicialesDe('Dra. Adriana Ureta')).toBe('AU')
    expect(inicialesDe('Clínica Bella Piel')).toBe('BP')
    expect(inicialesDe('Roberto')).toBe('R')
    expect(inicialesDe('+52 667 164 7799')).toBe('#')
    expect(inicialesDe('')).toBe('#')
  })
  it('el mismo cliente siempre tiene el mismo color', () => {
    expect(avatarColor('Adriana Ureta')).toBe(avatarColor('Adriana Ureta'))
  })
})

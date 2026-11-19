// AUDITORÍA CHOFER (19 nov 2026) · el botón «Llamar» armaba tel:+52+52… con los teléfonos de Odoo
import { describe, expect, it } from 'vitest'
import { telParaMarcar } from './telefono'
describe('telParaMarcar', () => {
  it('normaliza los formatos reales de la base', () => {
    expect(telParaMarcar('+52 667 427 6660')).toBe('+526674276660')
    expect(telParaMarcar('6674276660')).toBe('+526674276660')
    expect(telParaMarcar('+52 1 667 427 6660')).toBe('+526674276660')
    expect(telParaMarcar('961-611-1843 961-611-4287')).toBe('+529616111843')
  })
  it('sin número válido no hay botón', () => {
    expect(telParaMarcar('—')).toBeNull(); expect(telParaMarcar('')).toBeNull(); expect(telParaMarcar(null)).toBeNull(); expect(telParaMarcar('12345')).toBeNull()
  })
})

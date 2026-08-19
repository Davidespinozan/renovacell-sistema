// Regresión: el backend devuelve company_settings con columnas NULL; normalizeCompany debe
// colapsarlas a '' para que la UI (validación de RFC con .trim()) no reviente. Bug real que
// cazó el smoke de backend en la pantalla de Configuración.
import { describe, it, expect } from 'vitest'
import { normalizeCompany } from './companyStore'

describe('normalizeCompany', () => {
  it('colapsa NULL/undefined a cadena vacía (nunca deja null)', () => {
    const c = normalizeCompany({ razon_social: null, rfc: null, regimen_fiscal: null, cp: null, direccion: null, telefono: null, email: null, logo_url: null })
    expect(Object.values(c).every((v) => v === '')).toBe(true)
    // Ningún valor es null → .trim() nunca revienta.
    expect(() => c.rfc.trim()).not.toThrow()
  })

  it('conserva los valores presentes y rellena los faltantes', () => {
    const c = normalizeCompany({ razon_social: 'Renovacell SA', rfc: 'XAXX010101000' })
    expect(c.razon_social).toBe('Renovacell SA')
    expect(c.rfc).toBe('XAXX010101000')
    expect(c.telefono).toBe('')
  })

  it('tolera fila null (sin datos aún)', () => {
    const c = normalizeCompany(null)
    expect(c.razon_social).toBe('')
  })
})

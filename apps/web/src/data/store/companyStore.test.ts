// Regresión: el backend devuelve company_settings con columnas NULL; normalizeCompany debe
// colapsarlas a '' para que la UI (validación de RFC con .trim()) no reviente. Bug real que
// cazó el smoke de backend en la pantalla de Configuración.
import { describe, it, expect } from 'vitest'
import { EMPTY_COMPANY, normalizeCompany } from './companyStore'

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

describe('ORIGEN ESTRUCTURADO (183)', () => {
  it('normaliza los cinco campos nuevos (null → "") y EMPTY_COMPANY los trae vacíos', () => {
    const c = normalizeCompany({ shipping_street: 'Nuevo Mundo', shipping_ext_number: '1045', shipping_int_number: null, shipping_colonia: 'Las Quintas', shipping_references: null })
    expect(c).toMatchObject({ shipping_street: 'Nuevo Mundo', shipping_ext_number: '1045', shipping_int_number: '', shipping_colonia: 'Las Quintas', shipping_references: '' })
    expect(EMPTY_COMPANY).toMatchObject({ shipping_street: '', shipping_ext_number: '', shipping_int_number: '', shipping_colonia: '', shipping_references: '' })
  })
})

// Perfil fiscal canónico: normalización omnicanal, validación (PF/PM) y completitud.
import { describe, it, expect } from 'vitest'
import { normalizeFiscalProfile, validateFiscalProfile, isFiscalProfileComplete, personTypeFromRfc, emptyFiscalProfile } from './fiscal'

const completoPF = { rfc: 'GODE561231GR8', razon_social: 'Dra. Ejemplo', regimen: '612', cp: '80020', uso_cfdi: 'G03', email_facturacion: 'dra@ejemplo.mx' }
const completoPM = { rfc: 'ABC101010AB1', razon_social: 'Clínica SA de CV', regimen: '601', cp: '06700', uso_cfdi: 'G03', email_facturacion: 'facturas@clinica.mx' }

describe('normalizeFiscalProfile — un solo contrato desde cualquier origen', () => {
  it('canónico: normaliza RFC a mayúsculas y email a minúsculas', () => {
    const f = normalizeFiscalProfile({ ...completoPF, rfc: 'gode561231gr8', email_facturacion: 'DRA@Ejemplo.MX' })
    expect(f.rfc).toBe('GODE561231GR8')
    expect(f.email_facturacion).toBe('dra@ejemplo.mx')
  })
  it('legacy profiles.meta.fiscal (name/taxRegime/taxZip/cfdiUse) → canónico', () => {
    const f = normalizeFiscalProfile({ rfc: 'GODE561231GR8', name: 'Dra. Legacy', taxRegime: '612', taxZip: '80020', cfdiUse: 'G03' })
    expect(f.razon_social).toBe('Dra. Legacy')
    expect(f.regimen).toBe('612')
    expect(f.cp).toBe('80020')
    expect(f.uso_cfdi).toBe('G03')
    expect(f.email_facturacion).toBe('') // legacy no tenía email de facturación
  })
  it('parcial POS (razon_social/uso_cfdi/email) → mapea email a email_facturacion', () => {
    const f = normalizeFiscalProfile({ rfc: 'ABC101010AB1', razon_social: 'X', uso_cfdi: 'G03', email: 'pos@x.mx' })
    expect(f.email_facturacion).toBe('pos@x.mx')
  })
  it('nada → vacío canónico (nunca inventa valores)', () => {
    expect(normalizeFiscalProfile(undefined)).toEqual(emptyFiscalProfile())
  })
})

describe('validateFiscalProfile — reglas mínimas', () => {
  it('PF completo válido', () => expect(validateFiscalProfile(completoPF).ok).toBe(true))
  it('PM completo válido', () => expect(validateFiscalProfile(completoPM).ok).toBe(true))

  it('exige los 6 campos', () => {
    const e = validateFiscalProfile(emptyFiscalProfile()).errors
    expect(Object.keys(e).sort()).toEqual(['cp', 'email_facturacion', 'razon_social', 'regimen', 'rfc', 'uso_cfdi'].sort())
  })
  it('RFC debe ser 12 o 13 caracteres', () => {
    expect(validateFiscalProfile({ ...completoPF, rfc: 'GODE561231G' }).errors.rfc).toBeTruthy() // 11
    expect(validateFiscalProfile({ ...completoPF, rfc: 'GODE561231GR8' }).errors.rfc).toBeUndefined() // 13 PF
    expect(validateFiscalProfile({ ...completoPM, rfc: 'ABC101010AB1' }).errors.rfc).toBeUndefined() // 12 PM
  })
  it('RFC con formato inválido se rechaza', () => {
    expect(validateFiscalProfile({ ...completoPF, rfc: '1234561231GR8' }).errors.rfc).toBeTruthy()
  })
  it('CP debe ser 5 dígitos', () => {
    expect(validateFiscalProfile({ ...completoPF, cp: '800' }).errors.cp).toBeTruthy()
    expect(validateFiscalProfile({ ...completoPF, cp: 'ABCDE' }).errors.cp).toBeTruthy()
  })
  it('régimen y uso deben existir en el catálogo SAT', () => {
    expect(validateFiscalProfile({ ...completoPF, regimen: '999' }).errors.regimen).toBeTruthy()
    expect(validateFiscalProfile({ ...completoPF, uso_cfdi: 'ZZZ' }).errors.uso_cfdi).toBeTruthy()
  })
  it('email de facturación con formato inválido se rechaza', () => {
    expect(validateFiscalProfile({ ...completoPF, email_facturacion: 'no-es-email' }).errors.email_facturacion).toBeTruthy()
  })
})

describe('isFiscalProfileComplete / personTypeFromRfc', () => {
  it('completo ⇔ validación ok', () => {
    expect(isFiscalProfileComplete(completoPF)).toBe(true)
    expect(isFiscalProfileComplete({ ...completoPF, cp: '' })).toBe(false)
  })
  it('infiere persona física (13) / moral (12) del RFC', () => {
    expect(personTypeFromRfc('GODE561231GR8')).toBe('fisica')
    expect(personTypeFromRfc('ABC101010AB1')).toBe('moral')
    expect(personTypeFromRfc('CORTO')).toBeNull()
  })
})

// Envío CFDI — reglas server-side puras (módulo compartido con la Edge Function cfdi-send).
import { describe, it, expect } from 'vitest'
import { puedeEnviar, normalizaEmail, emailValido, envioExitoso } from '../../../../../supabase/functions/cfdi-send/rules'

describe('puedeEnviar — solo CFDI timbrado real', () => {
  it('permite timbre real (timbrada + uuid + facturama_id, no simulado)', () => {
    expect(puedeEnviar({ status: 'timbrada', uuid: 'SAT-9', facturama_id: 'FAC-9', simulated: false }))
      .toEqual({ ok: true, facturamaId: 'FAC-9', uuid: 'SAT-9' })
  })
  it('bloquea simulated:true', () => {
    expect(puedeEnviar({ status: 'timbrada', uuid: 'x', facturama_id: 'y', simulated: true }).ok).toBe(false)
  })
  it('bloquea status emitida (folio simulado)', () => {
    expect(puedeEnviar({ status: 'emitida', uuid: 'SIM', simulated: true }).ok).toBe(false)
  })
  it('bloquea timbrada SIN facturama_id', () => {
    expect(puedeEnviar({ status: 'timbrada', uuid: 'SAT-9' }).ok).toBe(false)
    expect(puedeEnviar({ status: 'timbrada', uuid: 'SAT-9', facturama_id: '' }).ok).toBe(false)
  })
  it('bloquea null/vacío', () => {
    expect(puedeEnviar(null).ok).toBe(false)
    expect(puedeEnviar({}).ok).toBe(false)
  })
})

describe('normalizaEmail', () => {
  it('recorta y pasa a minúsculas', () => {
    expect(normalizaEmail('  Foo@Bar.MX ')).toBe('foo@bar.mx')
  })
  it('no-string → ""', () => {
    expect(normalizaEmail(undefined)).toBe('')
    expect(normalizaEmail(123)).toBe('')
  })
})

describe('emailValido', () => {
  it('acepta correos válidos', () => {
    for (const e of ['a@b.mx', 'laura.mendez@renova.mx', 'x_y+z@dominio.co']) expect(emailValido(e)).toBe(true)
  })
  it('rechaza inválidos', () => {
    for (const e of ['', 'a@b', 'a b@c.mx', 'sinarroba.mx', '@b.mx', 'a@.mx', 'a@b.', 'a'.repeat(250) + '@b.mx']) expect(emailValido(e)).toBe(false)
  })
})

describe('envioExitoso — solo 2xx Y success===true', () => {
  it('200 + success:true → true', () => {
    expect(envioExitoso(200, { success: true, msj: 'ok' })).toBe(true)
  })
  it('200 + success:false → false', () => {
    expect(envioExitoso(200, { success: false })).toBe(false)
  })
  it('502 + success:true → false (nunca éxito con error HTTP)', () => {
    expect(envioExitoso(502, { success: true })).toBe(false)
  })
  it('200 sin success → false', () => {
    expect(envioExitoso(200, {})).toBe(false)
    expect(envioExitoso(200, null)).toBe(false)
  })
})

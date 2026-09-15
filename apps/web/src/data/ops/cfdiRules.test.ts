// P0-CFDI #2 y #3 — reglas server-side de la Edge Function `cfdi` (módulo puro compartido).
import { describe, it, expect } from 'vitest'
import { cfdiYaTimbrado, lugarDeExpedicion } from '../../../../../supabase/functions/cfdi/rules'

describe('#3 idempotencia — cfdiYaTimbrado', () => {
  it('un pedido YA timbrado (uuid real) bloquea un segundo timbrado y devuelve su UUID', () => {
    const r = cfdiYaTimbrado({ status: 'timbrada', uuid: 'SAT-UUID-1', facturama_id: 'F1' })
    expect(r).toEqual({ uuid: 'SAT-UUID-1', facturama_id: 'F1' })
  })
  it('un folio simulado (emitida, sin timbre real) NO bloquea — puede timbrarse por 1ª vez', () => {
    expect(cfdiYaTimbrado({ status: 'emitida', uuid: 'SIM', simulated: true })).toBeNull()
  })
  it('sin CFDI (null / sin uuid) no bloquea', () => {
    expect(cfdiYaTimbrado(null)).toBeNull()
    expect(cfdiYaTimbrado({ status: 'timbrada' })).toBeNull()
  })
})

describe('#2 lugar de expedición — CP del EMISOR, jamás del receptor', () => {
  it('usa el CP fiscal del emisor cuando está configurado', () => {
    expect(lugarDeExpedicion({ cp: '80000' })).toEqual({ ok: true, cp: '80000' })
  })
  it('si falta el CP del emisor, FALLA explícito (no cae al CP del receptor)', () => {
    const r = lugarDeExpedicion({ cp: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_emisor')
    expect(lugarDeExpedicion(null).ok).toBe(false)
  })
})

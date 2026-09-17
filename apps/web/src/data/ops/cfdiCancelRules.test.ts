// Cancelación CFDI (motivos 02/03) — reglas server-side puras (módulo de la Edge Function cfdi-cancel).
import { describe, it, expect } from 'vitest'
import { motivoCancelValido, puedeCancelar, mapeaStatusCancelacion, accionAuditoria, construyeCancelMeta, construyeClaimMeta } from '../../../../../supabase/functions/cfdi-cancel/rules'

describe('motivoCancelValido — solo 02|03 (01/04 fuera de esta versión)', () => {
  it('acepta 02 y 03', () => { expect(motivoCancelValido('02')).toBe(true); expect(motivoCancelValido('03')).toBe(true) })
  it('rechaza 01, 04 y basura', () => { for (const b of ['01', '04', '', '2', null, undefined, 2]) expect(motivoCancelValido(b)).toBe(false) })
})

describe('puedeCancelar', () => {
  const ok = { status: 'timbrada', uuid: 'SAT-9', facturama_id: 'FAC-9', simulated: false }
  it('permite un timbre real sin cancelación previa', () => {
    expect(puedeCancelar(ok)).toEqual({ ok: true, facturamaId: 'FAC-9', uuid: 'SAT-9' })
  })
  it('bloquea simulado', () => { expect(puedeCancelar({ ...ok, simulated: true }).ok).toBe(false) })
  it('bloquea no timbrada / emitida', () => {
    expect(puedeCancelar({ status: 'emitida', uuid: 'x', facturama_id: 'y' }).ok).toBe(false)
  })
  it('bloquea sin facturama_id', () => { expect(puedeCancelar({ status: 'timbrada', uuid: 'SAT-9' }).ok).toBe(false) })
  it('bloquea si ya solicitada/pendiente/cancelada', () => {
    for (const s of ['solicitada', 'pendiente', 'cancelada']) {
      const r = puedeCancelar({ ...ok, cancel: { status: s } })
      expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toBe('already_requested')
    }
  })
  it('permite reintento si estaba rechazada', () => { expect(puedeCancelar({ ...ok, cancel: { status: 'rechazada' } }).ok).toBe(true) })
})

describe('mapeaStatusCancelacion', () => {
  it('canceled→cancelada, pending→pendiente, active→rechazada', () => {
    expect(mapeaStatusCancelacion('canceled')).toBe('cancelada')
    expect(mapeaStatusCancelacion('pending')).toBe('pendiente')
    expect(mapeaStatusCancelacion('active')).toBe('rechazada')
  })
  it('desconocido/ausente → null', () => {
    expect(mapeaStatusCancelacion('foo')).toBeNull(); expect(mapeaStatusCancelacion(undefined)).toBeNull()
  })
})

describe('accionAuditoria', () => {
  it('mapea estado→acción', () => {
    expect(accionAuditoria('cancelada')).toBe('CFDI cancelado')
    expect(accionAuditoria('pendiente')).toBe('CFDI cancelación solicitada')
    expect(accionAuditoria('rechazada')).toBe('CFDI cancelación fallida')
  })
})

describe('construyeCancelMeta — preserva todo y NUNCA persiste AcuseXmlBase64', () => {
  const existing = { uuid: 'SAT-9', status: 'timbrada', simulated: false, emitida_at: 'T0', facturama_id: 'FAC-9' }
  it('conserva campos del CFDI y añade cancel sin acuse xml', () => {
    const meta = construyeCancelMeta(existing, { status: 'cancelada', motive: '02', requested_at: 'T1', confirmed_at: 'T1', expiration_at: 'T2', is_cancelable: 'Cancelable sin aceptacion', message: 'ok', acuse_available: true })
    // Preserva todo el CFDI original
    expect(meta).toMatchObject(existing)
    // cancel correcto
    expect(meta.cancel).toMatchObject({ status: 'cancelada', motive: '02', requested_at: 'T1', confirmed_at: 'T1', acuse_available: true })
    // NUNCA persiste el acuse ni contenido fiscal
    expect(JSON.stringify(meta)).not.toMatch(/AcuseXmlBase64|base64/i)
  })
  it('pendiente sin confirmed_at', () => {
    const meta = construyeCancelMeta(existing, { status: 'pendiente', motive: '03', requested_at: 'T1', acuse_available: false })
    expect((meta.cancel as Record<string, unknown>).confirmed_at).toBeUndefined()
    expect(meta).toMatchObject(existing)
  })
  it('el estado FINAL nunca conserva claim_id (aunque el existente lo tuviera)', () => {
    const conClaim = { ...existing, cancel: { status: 'solicitada', motive: '02', claim_id: 'CID-1' } }
    const meta = construyeCancelMeta(conClaim, { status: 'cancelada', motive: '02', requested_at: 'T1', confirmed_at: 'T1', acuse_available: false })
    expect((meta.cancel as Record<string, unknown>).claim_id).toBeUndefined()
    expect(JSON.stringify(meta)).not.toMatch(/claim_id/)
  })
})

describe('construyeClaimMeta — claim atómico efímero', () => {
  const existing = { uuid: 'SAT-9', status: 'timbrada', simulated: false, emitida_at: 'T0', facturama_id: 'FAC-9' }
  it('marca solicitada + claim_id y preserva el CFDI', () => {
    const m = construyeClaimMeta(existing, '02', 'T1', 'CID-9')
    expect(m).toMatchObject(existing)
    expect(m.cancel).toEqual({ status: 'solicitada', motive: '02', requested_at: 'T1', claim_id: 'CID-9' })
  })
  it('funciona desde un estado previo rechazada (reintento)', () => {
    const prev = { ...existing, cancel: { status: 'rechazada', motive: '03' } }
    const m = construyeClaimMeta(prev, '02', 'T2', 'CID-2')
    expect((m.cancel as Record<string, unknown>).status).toBe('solicitada')
    expect((m.cancel as Record<string, unknown>).claim_id).toBe('CID-2')
  })
})

// Sincronización de estatus de cancelación — reglas puras (módulo de cfdi-cancel-status).
import { describe, it, expect } from 'vitest'
import { puedeConsultar, mapeaStatusDetalle, actualizaCancelStatus, accionActualizacion } from '../../../../../supabase/functions/cfdi-cancel-status/rules'

describe('puedeConsultar — solo desde pendiente', () => {
  it('permite si cancel.status=pendiente y hay facturama_id', () => {
    expect(puedeConsultar({ facturama_id: 'FAC-9', cancel: { status: 'pendiente' } })).toEqual({ ok: true, facturamaId: 'FAC-9' })
  })
  it('bloquea si no está pendiente', () => {
    for (const s of ['cancelada', 'rechazada', undefined]) expect(puedeConsultar({ facturama_id: 'FAC-9', cancel: { status: s } }).ok).toBe(false)
    expect(puedeConsultar(null).ok).toBe(false)
  })
  it('bloquea sin facturama_id', () => { expect(puedeConsultar({ cancel: { status: 'pendiente' } }).ok).toBe(false) })
})

describe('mapeaStatusDetalle', () => {
  it('canceled→cancelada, pending→pendiente, active→rechazada, desconocido→null', () => {
    expect(mapeaStatusDetalle('canceled')).toBe('cancelada')
    expect(mapeaStatusDetalle('pending')).toBe('pendiente')
    expect(mapeaStatusDetalle('active')).toBe('rechazada')
    expect(mapeaStatusDetalle('vigente')).toBe('rechazada')
    expect(mapeaStatusDetalle('???')).toBeNull()
  })
})

describe('actualizaCancelStatus — preserva el resto', () => {
  const existing = { uuid: 'SAT-9', facturama_id: 'FAC-9', status: 'timbrada', cancel: { status: 'pendiente', motive: '02', requested_at: 'T1' } }
  it('pendiente→cancelada añade confirmed_at y conserva motive/uuid', () => {
    const meta = actualizaCancelStatus(existing, 'cancelada', 'T9')
    expect(meta).toMatchObject({ uuid: 'SAT-9', facturama_id: 'FAC-9' })
    expect(meta.cancel).toMatchObject({ status: 'cancelada', motive: '02', requested_at: 'T1', confirmed_at: 'T9' })
  })
  it('pendiente→rechazada sin confirmed_at', () => {
    const meta = actualizaCancelStatus(existing, 'rechazada', 'T9')
    expect((meta.cancel as Record<string, unknown>).status).toBe('rechazada')
    expect((meta.cancel as Record<string, unknown>).confirmed_at).toBeUndefined()
  })
})

describe('accionActualizacion', () => {
  it('solo audita cambios reales', () => {
    expect(accionActualizacion('pendiente', 'cancelada')).toBe('CFDI cancelado')
    expect(accionActualizacion('pendiente', 'rechazada')).toBe('CFDI cancelación fallida')
    expect(accionActualizacion('pendiente', 'pendiente')).toBeNull()
  })
})

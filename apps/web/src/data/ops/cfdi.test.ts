// P0-CFDI #1 — un CFDI ya timbrado (o emitido simulado) se reconoce como emitido, para que
// ninguna UI ofrezca "Emitir CFDI" de nuevo (fix doble timbrado).
import { describe, it, expect } from 'vitest'
import { tieneCfdi } from './cfdi'
import { mkOrder } from '../../test/factories'

describe('tieneCfdi — fuente única del estado del CFDI', () => {
  it('reconoce el timbre REAL de Facturama (status timbrada)', () => {
    expect(tieneCfdi(mkOrder({ invoice_meta: { status: 'timbrada', uuid: 'ABC-123' } }))).toBe(true)
  })
  it('reconoce el folio simulado/optimista (status emitida)', () => {
    expect(tieneCfdi(mkOrder({ invoice_meta: { status: 'emitida', uuid: 'SIM-1', simulated: true } }))).toBe(true)
  })
  it('sin CFDI (invoice_meta null u otro status) → no emitido', () => {
    expect(tieneCfdi(mkOrder({ invoice_meta: null }))).toBe(false)
    expect(tieneCfdi(mkOrder({ invoice_meta: { status: 'pendiente' } }))).toBe(false)
  })
})

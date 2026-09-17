// Descarga CFDI — reglas server-side puras (módulo compartido con la Edge Function cfdi-download).
import { describe, it, expect } from 'vitest'
import { formatoValido, puedeDescargar, mimeDe, nombreArchivo } from '../../../../../supabase/functions/cfdi-download/rules'

describe('formatoValido — solo xml|pdf', () => {
  it('acepta xml y pdf', () => {
    expect(formatoValido('xml')).toBe(true)
    expect(formatoValido('pdf')).toBe(true)
  })
  it('rechaza cualquier otro valor', () => {
    for (const bad of ['XML', 'PDF', 'zip', 'html', '', null, undefined, 1, {}]) expect(formatoValido(bad)).toBe(false)
  })
})

describe('puedeDescargar — solo CFDI timbrado real', () => {
  it('permite un timbre real (timbrada + uuid + facturama_id, no simulado)', () => {
    const r = puedeDescargar({ status: 'timbrada', uuid: 'SAT-9', facturama_id: 'FAC-9', simulated: false })
    expect(r).toEqual({ ok: true, facturamaId: 'FAC-9', uuid: 'SAT-9' })
  })
  it('bloquea folio simulado (simulated:true)', () => {
    const r = puedeDescargar({ status: 'timbrada', uuid: 'x', facturama_id: 'y', simulated: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('not_stamped')
  })
  it('bloquea status emitida (sin timbre real)', () => {
    expect(puedeDescargar({ status: 'emitida', uuid: 'SIM', simulated: true }).ok).toBe(false)
  })
  it('bloquea timbrada SIN facturama_id', () => {
    expect(puedeDescargar({ status: 'timbrada', uuid: 'SAT-9' }).ok).toBe(false)
    expect(puedeDescargar({ status: 'timbrada', uuid: 'SAT-9', facturama_id: '' }).ok).toBe(false)
  })
  it('bloquea invoice_meta null/vacío', () => {
    expect(puedeDescargar(null).ok).toBe(false)
    expect(puedeDescargar({}).ok).toBe(false)
  })
})

describe('mimeDe — MIME correcto', () => {
  it('xml → application/xml, pdf → application/pdf', () => {
    expect(mimeDe('xml')).toBe('application/xml')
    expect(mimeDe('pdf')).toBe('application/pdf')
  })
})

describe('nombreArchivo — legible, saneado, extensión correcta', () => {
  it('compone <folio>_<uuid>.<ext>', () => {
    expect(nombreArchivo('S019375', '883dbf78-04c1-4a82-942c-707792030f15', 'xml'))
      .toBe('S019375_883dbf78-04c1-4a82-942c-707792030f15.xml')
    expect(nombreArchivo('RC-1003', 'ABC-123', 'pdf')).toBe('RC-1003_ABC-123.pdf')
  })
  it('sanitiza caracteres peligrosos (rutas, espacios) y usa fallback si falta folio', () => {
    const n = nombreArchivo('../../etc/pas wd', 'u1', 'xml')
    expect(n).not.toMatch(/[/\\ ]/)
    expect(n.endsWith('.xml')).toBe(true)
    expect(nombreArchivo('', 'u1', 'pdf')).toBe('CFDI_u1.pdf')
  })
})

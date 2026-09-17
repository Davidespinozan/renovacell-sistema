// @vitest-environment jsdom
// Descarga CFDI (cliente): éxito → base64 se convierte a Blob y se dispara la descarga;
// error → NO se dispara descarga y se notifica el error real.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { functions: { invoke: h.invoke } } }))
vi.mock('../store/notificationsStore', () => ({ notify: h.notify }))

import { downloadCfdi } from './cfdiDownload'

// FunctionsHttpError-like: el detalle vive en context.json().
const httpError = (message: string) => ({ message: 'non-2xx', context: { json: async () => ({ message }) } })

let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let clickSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  h.invoke.mockReset(); h.notify.mockReset()
  createObjectURL = vi.fn(() => 'blob:fake')
  revokeObjectURL = vi.fn()
  // jsdom no implementa createObjectURL: lo proveemos.
  ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL
  ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

describe('downloadCfdi — éxito', () => {
  it('XML: convierte base64 a Blob y dispara la descarga (sin notificar error)', async () => {
    // 'PHhtbC8+' = base64 de '<xml/>'
    h.invoke.mockResolvedValue({ data: { filename: 'S019375_uuid.xml', contentType: 'application/xml', base64: 'PHhtbC8+' }, error: null })
    const ok = await downloadCfdi('o-1', 'xml')
    expect(ok).toBe(true)
    expect(h.invoke).toHaveBeenCalledWith('cfdi-download', { body: { order_id: 'o-1', format: 'xml' } })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('PDF: dispara la descarga', async () => {
    h.invoke.mockResolvedValue({ data: { filename: 'S019375_uuid.pdf', contentType: 'application/pdf', base64: 'JVBERg==' }, error: null })
    const ok = await downloadCfdi('o-1', 'pdf')
    expect(ok).toBe(true)
    expect(h.invoke).toHaveBeenCalledWith('cfdi-download', { body: { order_id: 'o-1', format: 'pdf' } })
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})

describe('downloadCfdi — error NO dispara descarga', () => {
  it('404: notifica el error real y no descarga', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError('El CFDI no se encontró en Facturama (¿cancelado o no disponible?).') })
    const ok = await downloadCfdi('o-1', 'xml')
    expect(ok).toBe(false)
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(clickSpy).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('no se encontró') }))
  })

  it('501 not_configured: notifica y no descarga', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError('CFDI no habilitado. Agrega FACTURAMA_USER/FACTURAMA_PASSWORD.') })
    const ok = await downloadCfdi('o-1', 'pdf')
    expect(ok).toBe(false)
    expect(clickSpy).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('CFDI') }))
  })

  it('respuesta sin base64: no descarga', async () => {
    h.invoke.mockResolvedValue({ data: { filename: 'x', contentType: 'application/xml' }, error: null })
    const ok = await downloadCfdi('o-1', 'xml')
    expect(ok).toBe(false)
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})

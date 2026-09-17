// Envío CFDI (cliente): éxito → notifica destinatario; error → NO notifica éxito y muestra el
// error real. Con override de email o fallback al perfil (server-side).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { functions: { invoke: h.invoke } } }))
vi.mock('../store/notificationsStore', () => ({ notify: h.notify }))

import { sendCfdi, emailValido } from './cfdiSend'

const httpError = (message: string) => ({ message: 'non-2xx', context: { json: async () => ({ message }) } })

beforeEach(() => { h.invoke.mockReset(); h.notify.mockReset() })

describe('emailValido (cliente, espeja al backend)', () => {
  it('valida/rechaza', () => {
    expect(emailValido('a@b.mx')).toBe(true)
    expect(emailValido('a@b')).toBe(false)
    expect(emailValido('')).toBe(false)
  })
})

describe('sendCfdi — éxito', () => {
  it('con override de email: manda el email (normalizado) y notifica al destinatario', async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, email: 'x@y.mx' }, error: null })
    const ok = await sendCfdi('o-1', '  X@Y.MX ')
    expect(ok).toBe(true)
    expect(h.invoke).toHaveBeenCalledWith('cfdi-send', { body: { order_id: 'o-1', email: 'x@y.mx' } })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('x@y.mx') }))
  })

  it('sin email: NO manda email (el backend resuelve profiles.email) y notifica el usado', async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, email: 'doc@x.mx' }, error: null })
    const ok = await sendCfdi('o-1')
    expect(ok).toBe(true)
    expect(h.invoke).toHaveBeenCalledWith('cfdi-send', { body: { order_id: 'o-1' } })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('doc@x.mx') }))
  })
})

describe('sendCfdi — error NO notifica éxito', () => {
  it('422 email_missing: notifica el error real, no éxito', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError('No hay correo del cliente; captúralo para enviar.') })
    const ok = await sendCfdi('o-1')
    expect(ok).toBe(false)
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('No hay correo') }))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Factura enviada') }))
  })

  it('502 facturama: notifica error, no éxito', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError('No se pudo enviar el CFDI.') })
    const ok = await sendCfdi('o-1', 'a@b.mx')
    expect(ok).toBe(false)
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Factura enviada') }))
  })

  it('data.ok falso (sin éxito real) → false', async () => {
    h.invoke.mockResolvedValue({ data: { ok: false }, error: null })
    const ok = await sendCfdi('o-1', 'a@b.mx')
    expect(ok).toBe(false)
  })
})

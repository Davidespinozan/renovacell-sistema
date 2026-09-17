// Cancelación CFDI (cliente): mapea la respuesta a estado y notifica; error → no éxito.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { functions: { invoke: h.invoke } } }))
vi.mock('../store/notificationsStore', () => ({ notify: h.notify }))

import { cancelCfdi, refreshCancelStatus } from './cfdiCancel'

const httpError = (message: string) => ({ message: 'non-2xx', context: { json: async () => ({ message }) } })
beforeEach(() => { h.invoke.mockReset(); h.notify.mockReset() })

describe('cancelCfdi', () => {
  it('canceled → "cancelada" y manda confirm:true + motive', async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, cancel: { status: 'cancelada', motive: '02' } }, error: null })
    const s = await cancelCfdi('o-1', '02')
    expect(s).toBe('cancelada')
    expect(h.invoke).toHaveBeenCalledWith('cfdi-cancel', { body: { order_id: 'o-1', motive: '02', confirm: true } })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('cancelado') }))
  })
  it('pending → "pendiente"', async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, cancel: { status: 'pendiente' } }, error: null })
    expect(await cancelCfdi('o-1', '03')).toBe('pendiente')
  })
  it('error 409 → null y notifica el error real, sin éxito', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError('La cancelación ya fue solicitada o el CFDI ya está cancelado.') })
    const s = await cancelCfdi('o-1', '02')
    expect(s).toBeNull()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('ya fue solicitada') }))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('cancelado ante el SAT') }))
  })
})

describe('refreshCancelStatus', () => {
  it('cambia a cancelada → notifica', async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, changed: true, cancel: { status: 'cancelada' } }, error: null })
    expect(await refreshCancelStatus('o-1')).toBe('cancelada')
    expect(h.invoke).toHaveBeenCalledWith('cfdi-cancel-status', { body: { order_id: 'o-1' } })
    expect(h.notify).toHaveBeenCalled()
  })
  it('sin cambio (sigue pendiente) → no notifica', async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, changed: false, cancel: { status: 'pendiente' } }, error: null })
    expect(await refreshCancelStatus('o-1')).toBe('pendiente')
    expect(h.notify).not.toHaveBeenCalled()
  })
  it('error → null', async () => {
    h.invoke.mockResolvedValue({ data: null, error: httpError('Solo se puede actualizar el estatus de una cancelación pendiente.') })
    expect(await refreshCancelStatus('o-1')).toBeNull()
  })
})

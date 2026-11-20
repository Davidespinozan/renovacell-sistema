import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn(async () => ({ data: 'nuevo', error: null }))
vi.mock('./supabase', () => ({ hasSupabase: true, supabase: { rpc: (...a: unknown[]) => rpc(...(a as [])) } }))

describe('alertas de errores (cliente)', () => {
  beforeEach(() => { rpc.mockClear(); vi.resetModules() })
  it('manda un error real una sola vez por sesión (mismo error con otros números = el mismo)', async () => {
    const { registrarError } = await import('./errores')
    registrarError('cliente', new TypeError('x is undefined at 12'))
    registrarError('cliente', new TypeError('x is undefined at 99'))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('registrar_error')
  })
  it('ignora el ruido (extensiones, red caída, ResizeObserver)', async () => {
    const { registrarError } = await import('./errores')
    registrarError('cliente', new Error('Failed to fetch'))
    registrarError('cliente', 'ResizeObserver loop completed with undelivered notifications.')
    registrarError('cliente', new Error('boom at chrome-extension://abc/x.js'))
    expect(rpc).not.toHaveBeenCalled()
  })
  it('no manda credenciales', async () => {
    const { registrarError } = await import('./errores')
    registrarError('escritura', 'fallo con Bearer abcdefghijklmnop1234')
    const args = rpc.mock.calls[0]?.[1] as { p_mensaje: string } | undefined
    expect(args?.p_mensaje ?? '').not.toMatch(/abcdefghijklmnop1234/)
  })
})

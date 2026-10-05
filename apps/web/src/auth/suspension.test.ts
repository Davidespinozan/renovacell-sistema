// @vitest-environment jsdom
// W6-A1 · El navegador cierra la sesión al recibir CUENTA_SUSPENDIDA y deja el motivo
// para la pantalla de entrada; el runner y los embudos de error lo disparan.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })), rpc: vi.fn(), from: vi.fn() }))
vi.mock('../lib/supabase', () => ({ hasSupabase: true, supabase: { auth: { signOut: mocks.signOut }, rpc: mocks.rpc, from: mocks.from } }))

import { atenderSuspension, esSuspension, motivoCierreSesion, CUENTA_SUSPENDIDA_MSG } from './suspension'
import { mensajeDeError } from '../data/store/escritura'
import { runW1Command } from '../data/ops/w1Command'
import { signInSupabase } from './supabaseAuth'

beforeEach(() => { mocks.signOut.mockClear(); mocks.rpc.mockReset(); mocks.from.mockReset(); sessionStorage.clear() })

describe('atenderSuspension', () => {
  it('reconoce el código del servidor', () => {
    expect(esSuspension('CUENTA_SUSPENDIDA: tu acceso fue suspendido por Dirección.')).toBe(true)
    expect(esSuspension('NO_AUTORIZADO: solo Dirección')).toBe(false)
    expect(esSuspension(null)).toBe(false)
  })
  it('cierra la sesión y deja el motivo para la entrada (una sola vez)', async () => {
    expect(atenderSuspension('CUENTA_SUSPENDIDA: x')).toBe(true)
    await Promise.resolve()
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(motivoCierreSesion()).toBe(CUENTA_SUSPENDIDA_MSG)
    expect(motivoCierreSesion()).toBeNull() // se consume
  })
  it('otro error no cierra nada', () => {
    expect(atenderSuspension('NO_AUTORIZADO: x')).toBe(false)
    expect(mocks.signOut).not.toHaveBeenCalled()
  })
})

describe('embudos de error', () => {
  it('mensajeDeError traduce y cierra la sesión', async () => {
    expect(mensajeDeError({ message: 'CUENTA_SUSPENDIDA: tu acceso fue suspendido por Dirección.' }, 'comando')).toBe('Tu acceso fue suspendido por Dirección.')
    await Promise.resolve()
    expect(mocks.signOut).toHaveBeenCalled()
  })
  it('un comando W1 rechazado por suspensión devuelve el código y cierra la sesión', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'CUENTA_SUSPENDIDA: tu acceso fue suspendido por Dirección.', code: 'P0001' } })
    const r = await runW1Command('ajustar_lote', {} as never, 'op-1')
    expect(r).toMatchObject({ ok: false, code: 'CUENTA_SUSPENDIDA' })
    await Promise.resolve()
    expect(mocks.signOut).toHaveBeenCalled()
  })
})

describe('inicio de sesión de una cuenta suspendida', () => {
  it('el perfil trae active=false → se cierra la sesión recién abierta y se explica', async () => {
    const auth = { signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'a@x.mx' } }, error: null })), signOut: mocks.signOut }
    ;(await import('../lib/supabase')).supabase.auth = auth as never
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: { role_id: 'pos', verified: true, full_name: 'P', meta: {}, active: false }, error: null }) }) }) })
    const r = await signInSupabase('a@x.mx', 'clave')
    expect(r.error).toBe(CUENTA_SUSPENDIDA_MSG)
    expect(mocks.signOut).toHaveBeenCalled()
  })
  it('el servidor niega la lectura con CUENTA_SUSPENDIDA → mismo resultado', async () => {
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'CUENTA_SUSPENDIDA: x' } }) }) }) })
    const r = await signInSupabase('a@x.mx', 'clave')
    expect(r.error).toBe(CUENTA_SUSPENDIDA_MSG)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Oyente = (ev: string, session: { user: { id: string } } | null) => void
const h = vi.hoisted(() => ({ oyentes: [] as Oyente[] }))
vi.mock('./supabase', () => ({ supabase: { auth: { onAuthStateChange: (cb: Oyente) => { h.oyentes.push(cb) } } } }))
import { alCambiarSesion, REFRESCO_MIN_MS } from './sesion'
import { conRegion } from './supabase.region'

const emitir = (ev: string, uid: string | null) => h.oyentes.forEach((cb) => cb(ev, uid ? { user: { id: uid } } : null))

describe('alCambiarSesion (PERF: no re-descargar la base al volver a la pestaña)', () => {
  beforeEach(() => { h.oyentes.length = 0; vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('avisa cambio en la sesión inicial, al entrar, al salir y al cambiar de cuenta', () => {
    const cb = vi.fn(); alCambiarSesion(cb)
    emitir('INITIAL_SESSION', null); emitir('SIGNED_IN', 'A'); emitir('SIGNED_OUT', null); emitir('SIGNED_IN', 'B')
    expect(cb.mock.calls).toEqual([['cambio', null], ['cambio', 'A'], ['cambio', null], ['cambio', 'B']])
  })

  it('SIGNED_IN / TOKEN_REFRESHED del mismo usuario (volver a la pestaña, renovación) no recargan', () => {
    const cb = vi.fn(); alCambiarSesion(cb)
    emitir('INITIAL_SESSION', 'A')
    for (let i = 0; i < 20; i++) emitir('SIGNED_IN', 'A')
    emitir('TOKEN_REFRESHED', 'A')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('pasado REFRESCO_MIN_MS, el mismo usuario recibe un refresco silencioso (uno solo)', () => {
    const cb = vi.fn(); alCambiarSesion(cb)
    emitir('INITIAL_SESSION', 'A')
    vi.advanceTimersByTime(REFRESCO_MIN_MS)
    emitir('SIGNED_IN', 'A'); emitir('SIGNED_IN', 'A'); emitir('TOKEN_REFRESHED', 'A')
    expect(cb.mock.calls).toEqual([['cambio', 'A'], ['refresco', 'A']])
  })

  it('cada suscriptor lleva su propia cuenta (un store que se importa tarde igual recibe su sesión inicial)', () => {
    const a = vi.fn(); alCambiarSesion(a)
    emitir('INITIAL_SESSION', 'A')
    const b = vi.fn(); alCambiarSesion(b)
    h.oyentes[1]('INITIAL_SESSION', { user: { id: 'A' } })
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledWith('cambio', 'A')
  })
})

describe('conRegion (PERF: Edges junto a la base)', () => {
  it('fija la región solo en llamadas a funciones, como parámetro (sin cabecera que pase por CORS)', () => {
    expect(conRegion('https://x.supabase.co/functions/v1/chat')).toBe('https://x.supabase.co/functions/v1/chat?forceFunctionRegion=us-west-1')
    expect(conRegion('https://x.supabase.co/functions/v1/shipping?a=1')).toBe('https://x.supabase.co/functions/v1/shipping?a=1&forceFunctionRegion=us-west-1')
    expect(conRegion('https://x.supabase.co/rest/v1/orders?select=*')).toBe('https://x.supabase.co/rest/v1/orders?select=*')
    expect(conRegion('https://x.supabase.co/functions/v1/chat?forceFunctionRegion=eu-west-1')).toBe('https://x.supabase.co/functions/v1/chat?forceFunctionRegion=eu-west-1')
  })
})

// @vitest-environment jsdom
// GPS EN LA ENTREGA · el teléfono del chofer avisa a la oficina cuando su ubicación está bloqueada (o activa), una vez por cambio.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const h = vi.hoisted(() => ({ reportes: [] as string[] }))
vi.mock('../ops/ubicacionChofer', () => ({
  ubicacionChofer: () => ({ registrar: async () => 'ok', reportarGps: async (e: string) => { h.reportes.push(e) } }),
}))
import { useRastreoRuta } from './useRastreoRuta'

beforeEach(() => { h.reportes = [] })

describe('useRastreoRuta · aviso a la oficina', () => {
  it('permiso bloqueado → reporta «denegado» una sola vez', async () => {
    const watch = vi.fn((_ok: PositionCallback, err: PositionErrorCallback) => { err({ code: 1 } as GeolocationPositionError); return 1 })
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, clearWatch: vi.fn() } })
    const r = renderHook(() => useRastreoRuta(true))
    await vi.waitFor(() => expect(r.result.current).toBe('denegado'))
    r.rerender()
    expect(h.reportes).toEqual(['denegado'])
  })
  it('fuera de ruta no reporta nada', () => {
    renderHook(() => useRastreoRuta(false))
    expect(h.reportes).toEqual([])
  })
})

// @vitest-environment jsdom
// PANTALLA ENCENDIDA · en ruta se pide no apagar la pantalla; al salir de ruta se suelta.
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePantallaEncendida } from './useRastreoRuta'

describe('pantalla encendida en ruta', () => {
  it('la pide en ruta y la suelta al terminar', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn(async () => ({ release }))
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
    const { rerender } = renderHook(({ a }) => usePantallaEncendida(a), { initialProps: { a: true } })
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
    rerender({ a: false })
    await vi.waitFor(() => expect(release).toHaveBeenCalled())
  })
  it('fuera de ruta no la pide', () => {
    const request = vi.fn(async () => ({ release: async () => {} }))
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
    renderHook(() => usePantallaEncendida(false))
    expect(request).not.toHaveBeenCalled()
  })
})

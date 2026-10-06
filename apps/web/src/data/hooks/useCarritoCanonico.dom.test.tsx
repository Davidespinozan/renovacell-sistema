// @vitest-environment jsdom
// CC-7 · El carrito del Catálogo/Asistente ES el carrito canónico del servidor: cada cambio es un
// comando (agregar/actualizar/quitar/vaciar) serializado; agregar vs actualizar lo decide el estado
// del SERVIDOR al ejecutar (doble clic → un "agregar" y luego "actualizar", nunca dos "agregar").
import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCarritoCanonico } from './useCarritoCanonico'
import type { Carrito, ClienteCarrito } from '../ops/carrito'

function servidorFalso(opts: { fallaAbrir?: boolean } = {}) {
  const items = new Map<string, number>(); const llamadas: string[] = []
  const proy = (): Carrito => ({ cart_id: 'K', estado: 'active', rev: llamadas.length, dueno: 'profile', audiencia: 'verified', puede_precio: true, conversation_id: null,
    items: [...items.entries()].map(([id, q]) => ({ product_id: id, nombre: id, presentacion: null, imagen_url: null, cantidad: q, vendible: true, visible: true, disponibilidad: 'disponible', precio: { estado: 'autorizado', unitario: 100, subtotal: 100 * q } })),
    n_items: items.size, cantidad_total: [...items.values()].reduce((s, q) => s + q, 0), total: { estado: items.size ? 'completo' : 'vacio', monto: 0 } })
  const lento = () => new Promise((r) => setTimeout(r, 5))
  const cliente = {
    abrir: async () => { llamadas.push('abrir'); return opts.fallaAbrir ? { ok: false as const, error: { codigo: 'red', mensaje: 'Sin red' } } : { ok: true as const, data: proy() } },
    agregar: async (_c: string, p: string, n: number) => { llamadas.push(`agregar:${p}:${n}`); await lento(); items.set(p, (items.get(p) ?? 0) + n); return { ok: true as const, data: {} } },
    actualizar: async (_c: string, p: string, n: number) => { llamadas.push(`actualizar:${p}:${n}`); await lento(); items.set(p, n); return { ok: true as const, data: {} } },
    quitar: async (_c: string, p: string) => { llamadas.push(`quitar:${p}`); await lento(); items.delete(p); return { ok: true as const, data: {} } },
    vaciar: async () => { llamadas.push('vaciar'); await lento(); items.clear(); return { ok: true as const, data: {} } },
  } as unknown as ClienteCarrito
  return { cliente, llamadas, items }
}

describe('useCarritoCanonico', () => {
  it('abre el carrito del servidor al montar (solo si está activo)', async () => {
    const s = servidorFalso()
    renderHook(() => useCarritoCanonico(false, s.cliente))
    expect(s.llamadas).toEqual([])
    const { result } = renderHook(() => useCarritoCanonico(true, s.cliente))
    await waitFor(() => expect(result.current.listo).toBe(true))
    expect(s.llamadas).toEqual(['abrir'])
  })
  it('26 · doble clic: las mutaciones se serializan y la segunda ve el estado del servidor (agregar → actualizar, nunca dos agregar)', async () => {
    const s = servidorFalso()
    const { result } = renderHook(() => useCarritoCanonico(true, s.cliente))
    await waitFor(() => expect(result.current.listo).toBe(true))
    await act(async () => { void result.current.fijar('A', 1); await result.current.fijar('A', 2) })
    expect(s.llamadas.filter((l) => !l.startsWith('abrir'))).toEqual(['agregar:A:1', 'actualizar:A:2'])
    expect(s.items.get('A')).toBe(2); expect(result.current.qty).toEqual({ A: 2 })
  })
  it('0 = quitar; vaciar; la vista optimista se limpia con la proyección del servidor', async () => {
    const s = servidorFalso()
    const { result } = renderHook(() => useCarritoCanonico(true, s.cliente))
    await waitFor(() => expect(result.current.listo).toBe(true))
    await act(async () => { await result.current.fijar('A', 1); await result.current.fijar('B', 3) })
    act(() => { void result.current.fijar('A', 0) })
    expect(result.current.qty.A).toBeUndefined()   // optimista inmediato
    await act(async () => { await result.current.esperar() })
    expect(s.llamadas).toContain('quitar:A')
    await act(async () => { await result.current.vaciar() })
    expect(s.items.size).toBe(0); expect(result.current.qty).toEqual({})
  })
  it('errores del servidor se muestran (no hay carrito paralelo en el navegador)', async () => {
    const s = servidorFalso({ fallaAbrir: true })
    const { result } = renderHook(() => useCarritoCanonico(true, s.cliente))
    await waitFor(() => expect(result.current.error).toBe('Sin red'))
    expect(result.current.listo).toBe(false)
  })
})

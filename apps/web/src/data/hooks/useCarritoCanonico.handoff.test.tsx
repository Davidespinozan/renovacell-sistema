// @vitest-environment jsdom
// UX V2-A · El hook del carrito canónico publica la apertura del chat SOLO cuando el servidor dice que la
// mutación generó un handoff nuevo; no por cantidades ni por reintentos.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCarritoCanonico } from './useCarritoCanonico'
import { ClienteCarrito, type Carrito, type Mutacion } from '../ops/carrito'
import { chatUi } from '../store/chatUiStore'

const cart = (items: Array<{ product_id: string; cantidad: number }>): Carrito => ({
  cart_id: 'K1', estado: 'active', rev: 1, dueno: 'profile', audiencia: 'verified', puede_precio: true, conversation_id: 'C1', n_items: items.length, cantidad_total: items.reduce((s, i) => s + i.cantidad, 0),
  items: items.map((i) => ({ ...i, nombre: 'P', presentacion: null, imagen_url: null, vendible: true, visible: true, disponibilidad: 'disponible', precio: { estado: 'autorizado', unitario: 350, subtotal: 350 * i.cantidad } })),
  total: { estado: 'completo', monto: 350 },
})
function clienteFalso(respuestas: Mutacion[]) {
  let estado = cart([])
  const c = new ClienteCarrito(async (_fn, { body }) => {
    const a = body.action as string
    if (a === 'abrir' || a === 'ver') return { data: estado, error: null }
    const m = respuestas.shift()!
    estado = cart(m.qty_despues > 0 ? [{ product_id: body.product_id as string, cantidad: m.qty_despues }] : [])
    return { data: m, error: null }
  }, () => null)
  return c
}
beforeEach(() => { sessionStorage.clear(); chatUi.reset() })

describe('useCarritoCanonico · handoff del servidor', () => {
  it('1 · primer artículo con handoff solicitado ⇒ solicita abrir el chat con la conversación del servidor', async () => {
    const c = clienteFalso([{ cart_id: 'K1', accion: 'agregar', qty_antes: 0, qty_despues: 1, n_items: 1, rev: 2, idempotente: false, handoff: { estado: 'solicitado', conversation_id: 'C1', asignado: true, fuera_horario: false } }])
    const { result } = renderHook(() => useCarritoCanonico(true, c))
    await waitFor(() => expect(result.current.listo).toBe(true))
    await act(async () => { await result.current.fijar('P1', 1) })
    expect(chatUi.getSnapshot()).toMatchObject({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1' })
  })
  it('3/4 · segundo producto, cambio de cantidad y replay idempotente no piden abrir', async () => {
    const c = clienteFalso([
      { cart_id: 'K1', accion: 'agregar', qty_antes: 0, qty_despues: 1, n_items: 2, rev: 3, idempotente: false, handoff: null },
      { cart_id: 'K1', accion: 'actualizar', qty_antes: 1, qty_despues: 2, n_items: 2, rev: 4, idempotente: false, handoff: null },
      { cart_id: 'K1', accion: 'agregar', qty_antes: 0, qty_despues: 1, n_items: 1, rev: 2, idempotente: true, handoff: { estado: 'solicitado', conversation_id: 'C1' } },
    ])
    const { result } = renderHook(() => useCarritoCanonico(true, c))
    await waitFor(() => expect(result.current.listo).toBe(true))
    await act(async () => { await result.current.fijar('P2', 1) })
    await act(async () => { await result.current.fijar('P2', 2) })
    await act(async () => { await result.current.fijar('P3', 1) })
    expect(chatUi.getSnapshot()).toBeNull()
  })
})

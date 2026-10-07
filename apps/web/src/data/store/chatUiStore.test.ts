// @vitest-environment jsdom
// UX V2-A · La decisión de abrir el chat nace SOLO de la respuesta del servidor a la mutación del carrito.
import { describe, it, expect, beforeEach } from 'vitest'
import { chatUi, handoffNuevoDe, yaAbiertoPara, marcarAbiertoPara } from './chatUiStore'
import type { Mutacion } from '../ops/carrito'

const base: Mutacion = { cart_id: 'K1', accion: 'agregar', qty_antes: 0, qty_despues: 1, n_items: 1, rev: 2, idempotente: false, handoff: null }
beforeEach(() => { sessionStorage.clear(); chatUi.reset() })

describe('handoffNuevoDe', () => {
  it('1 · handoff solicitado confirmado por el servidor ⇒ abrir', () => {
    expect(handoffNuevoDe({ ...base, handoff: { estado: 'solicitado', conversation_id: 'C1', asignado: true } })).toEqual({ conversationId: 'C1', cartId: 'K1', episodio: 'K1:2' })
  })
  it('2 · reintento idempotente ⇒ no reabre aunque traiga el handoff original', () => {
    expect(handoffNuevoDe({ ...base, idempotente: true, handoff: { estado: 'solicitado', conversation_id: 'C1' } })).toBeNull()
  })
  it('3/4 · mutación ordinaria (segundo producto, cantidad, quitar) ⇒ handoff null ⇒ nada', () => {
    expect(handoffNuevoDe(base)).toBeNull()
    expect(handoffNuevoDe({ ...base, accion: 'actualizar', qty_antes: 1, qty_despues: 3 })).toBeNull()
    expect(handoffNuevoDe({ ...base, accion: 'quitar', qty_despues: 0, n_items: 0 })).toBeNull()
  })
  it('handoff ya en curso o pendiente ⇒ no es una transición nueva', () => {
    expect(handoffNuevoDe({ ...base, handoff: { estado: 'solicitado', ya_en_curso: true } })).toBeNull()
    expect(handoffNuevoDe({ ...base, handoff: { estado: 'pendiente' } })).toBeNull()
    expect(handoffNuevoDe({ ...base, handoff: { estado: 'rechazado' } })).toBeNull()
    expect(handoffNuevoDe(null)).toBeNull()
  })
})

describe('store de presentación', () => {
  it('5 · una apertura por EPISODIO por pestaña; consumir la limpia', () => {
    expect(chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:2' })).toBe(true)
    const s = chatUi.getSnapshot()!
    expect(s.cartId).toBe('K1')
    chatUi.consumir(s.id)
    expect(chatUi.getSnapshot()).toBeNull()
    marcarAbiertoPara('K1:2')
    expect(yaAbiertoPara('K1:2')).toBe(true)
    expect(chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:2' })).toBe(false)
    expect(chatUi.getSnapshot()).toBeNull()
  })
  it('CI-2 · un episodio NUEVO del mismo carrito (otro rev) sí abre: el carrito no queda bloqueado para siempre', () => {
    marcarAbiertoPara('K1:2')
    expect(chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:9' })).toBe(true)
  })
  it('CI-2 · el episodio sale del servidor (carrito + rev); sin rev no se inventa', () => {
    expect(handoffNuevoDe({ ...base, rev: 9, handoff: { estado: 'solicitado', conversation_id: 'C1' } })?.episodio).toBe('K1:9')
    expect(handoffNuevoDe({ ...base, rev: undefined as unknown as number, handoff: { estado: 'solicitado', conversation_id: 'C1' } })).toBeNull()
  })
})

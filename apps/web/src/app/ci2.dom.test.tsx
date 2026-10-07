// @vitest-environment jsdom
// Commercial Intent · CI-2 · El frontend reconoce el EPISODIO que el servidor (CI-1) confirma, abre el chat al
// instante, lo difiere detrás del modal de variantes y lo abre EN CUANTO el modal se cierra (sin esperar al
// sondeo), con dedupe por episodio (carrito + rev del servidor) y la tarjeta comercial fija.
import React, { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const srv = vi.hoisted(() => ({ role: 'doctor' as string, screen: 'catalogo' }))
vi.mock('../auth/RoleContext', () => ({ useRole: () => ({ role: srv.role, screen: srv.screen, setScreen: vi.fn(), capabilities: [] }) }))

import { ChatFlotante } from './ChatFlotante'
import { useCarritoCanonico } from '../data/hooks/useCarritoCanonico'
import { ClienteCarrito, type Carrito } from '../data/ops/carrito'
import { ClienteChat, type ModoConversacion } from '../data/ops/chat'
import { chatUi } from '../data/store/chatUiStore'
import { claveC4 } from '../data/ops/autoapertura'

/** Servidor con la regla de CI-1: señal FUERTE (sube la cantidad) sin episodio vigente → episodio nuevo; dentro
 *  del episodio, nada; `cerrarSesion()` simula el cierre (terminar / C2) y rearma. Respuesta = contrato real. */
function servidor(opts: { modo?: ModoConversacion; latencia?: number } = {}) {
  const st = { items: {} as Record<string, number>, rev: 3, vivo: false, modo: opts.modo ?? 'ai_active' as ModoConversacion, episodios: 0, ops: new Map<string, unknown>(), seq: 9 }
  const llamadasChat: string[] = []
  const proyeccion = (): Carrito => ({ cart_id: 'K1', estado: 'active', rev: st.rev, dueno: 'profile', audiencia: 'verified', puede_precio: true, conversation_id: 'C1', n_items: Object.keys(st.items).length, cantidad_total: Object.values(st.items).reduce((a, b) => a + b, 0), total: { estado: 'vacio' },
    items: Object.entries(st.items).map(([product_id, cantidad]) => ({ product_id, nombre: product_id, presentacion: null, imagen_url: null, cantidad, vendible: true, visible: true, disponibilidad: 'disponible', precio: { estado: 'autorizado', unitario: 1, subtotal: cantidad } })) })
  const mutar = (accion: string, product: string | null, cantidad: number, op: string) => {
    if (st.ops.has(op)) return { ...(st.ops.get(op) as object), idempotente: true }
    const antes = product ? (st.items[product] ?? 0) : 0
    if (accion === 'agregar' || accion === 'actualizar') st.items[product!] = cantidad
    if (accion === 'quitar') delete st.items[product!]
    if (accion === 'vaciar') st.items = {}
    st.rev += 1
    const despues = product ? (st.items[product] ?? 0) : 0
    let handoff: Record<string, unknown> | null = null
    if ((accion === 'agregar' || accion === 'actualizar') && despues > antes && !st.vivo && st.modo !== 'human_active') {
      st.vivo = true; st.episodios += 1; st.modo = 'human_assigned'; st.seq += 1
      handoff = { estado: 'solicitado', conversation_id: 'C1', modo: 'human_assigned', asignado: true, fuera_horario: true, horario_configurado: false }
    }
    const res = { cart_id: 'K1', accion, qty_antes: antes, qty_despues: despues, n_items: Object.keys(st.items).length, rev: st.rev, idempotente: false, handoff }
    st.ops.set(op, res)
    return res
  }
  const espera = () => (opts.latencia ? new Promise((r) => setTimeout(r, opts.latencia)) : Promise.resolve())
  const carrito = new ClienteCarrito(async (_fn, { body }) => {
    const a = body.action as string
    if (a === 'abrir' || a === 'ver') return { data: proyeccion(), error: null }
    await espera()
    return { data: mutar(a, (body.product_id as string) ?? null, Number(body.cantidad ?? 0), String(body.operation_id ?? Math.random())), error: null }
  }, () => null)
  const chat = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string; llamadasChat.push(a)
    if (a === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: st.modo, nuevo: false }, error: null }
    if (a === 'leer') return { data: { conversation_id: 'C1', estado: 'abierta', modo: st.modo, rol: 'dueno', ultimo_seq: st.seq, leido_hasta: st.seq, asesor_nombre: st.vivo ? 'Lucía Hernández' : null, mensajes: [],
      sesion: st.vivo ? { id: 'S' + st.episodios, ordinal: st.episodios, estado: 'abierta', origen: 'carrito', first_seq: st.seq, last_seq: null, opened_at: new Date().toISOString(), closed_at: null, close_reason: null } : null,
      handoff: { origen: st.vivo ? 'carrito' : null, cart_id: 'K1', fuera_horario: true, asignado: st.vivo, puede_rechazar: st.vivo && st.modo !== 'human_active' } }, error: null }
    return { data: { ok: true }, error: null }
  }, () => null)
  const cerrarSesion = () => { st.vivo = false; st.modo = 'ai_active' }
  return { st, carrito, chat, llamadasChat, cerrarSesion }
}

/** Catálogo mínimo con un modal de variantes con el MISMO marcado (`.overlay` > `.modal`) que el real. */
function Catalogo({ carrito }: { carrito: ClienteCarrito }) {
  const c = useCarritoCanonico(true, carrito)
  const [modal, setModal] = useState(false)
  return (
    <div>
      <button onClick={() => void c.fijar('P1', (c.qty.P1 ?? 0) + 1)}>+P1</button>
      <button onClick={() => void c.fijar('P1', Math.max(0, (c.qty.P1 ?? 0) - 1))}>-P1</button>
      <button onClick={() => void c.vaciar()}>vaciar</button>
      <button onClick={() => setModal(true)}>familia</button>
      {modal && (
        <div className="overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => void c.fijar('V1', (c.qty.V1 ?? 0) + 1)}>+V1</button>
            <button onClick={() => setModal(false)}>cerrar-modal</button>
          </div>
        </div>
      )}
    </div>
  )
}

const esperar = (ms = 0) => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); if (ms) await new Promise((r) => setTimeout(r, ms)) })
const pulsar = async (t: string, ms = 0) => { fireEvent.click(screen.getByText(t)); await esperar(ms) }
const abierto = () => screen.queryAllByTestId('chat-drawer').length
const montar = (s: ReturnType<typeof servidor>) => render(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>)

beforeEach(() => { cleanup(); chatUi.reset(); sessionStorage.clear(); document.body.className = ''; srv.role = 'doctor'; srv.screen = 'catalogo' })

describe('CI-2 · intención comercial en el frontend', () => {
  it('1 · carrito nuevo, primer producto, episodio confirmado → abre al instante (sin sondeo) con la tarjeta comercial', async () => {
    const s = servidor()
    montar(s); await esperar()
    await pulsar('+P1')
    expect(abierto()).toBe(1)
    expect(screen.getByTestId('chat-drawer').getAttribute('data-apertura')).toBe('auto')
    expect(sessionStorage.getItem('rc_chat_handoff_abierto:K1:4')).toBe('1')   // episodio = carrito + rev del servidor
    expect((await screen.findByTestId('aviso-handoff')).textContent).toContain('Ya avisé a Lucía, tu asesora.')
    expect(screen.getByTestId('aviso-handoff').textContent).toContain('puedo ayudarte con productos, disponibilidad y formas de pago')
  })
  it('2/3 · carrito con un episodio ANTERIOR ya presentado en esta pestaña (solicitado o rechazado en una sesión cerrada) → el episodio nuevo SÍ abre', async () => {
    sessionStorage.setItem('rc_chat_handoff_abierto:K1:3', '1')     // episodio viejo del mismo carrito
    sessionStorage.setItem('rc_chat_handoff_abierto:K1', '1')       // y la clave por carrito de antes de CI-2
    const s = servidor()
    montar(s); await esperar()
    await pulsar('+P1')
    expect(abierto()).toBe(1)
  })
  it('4/5 · subir cantidad abre un episodio nuevo tras el cierre; dentro del mismo episodio no duplica', async () => {
    const s = servidor()
    montar(s); await esperar()
    await pulsar('+P1'); expect(abierto()).toBe(1)
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) }); await esperar()
    await pulsar('+P1'); await pulsar('+P1')                          // mismo episodio: el servidor no confirma nada nuevo
    expect(abierto()).toBe(0); expect(s.st.episodios).toBe(1)
    s.cerrarSesion()                                                  // la asesora terminó (o C2 cerró la sesión)
    await pulsar('+P1')                                               // subir cantidad = señal fuerte → episodio 2
    expect(s.st.episodios).toBe(2); expect(abierto()).toBe(1)
  })
  it('6/7 · desde el modal de variantes: difiere y abre EN CUANTO el modal se cierra (sin esperar 30 s)', async () => {
    const s = servidor()
    montar(s); await esperar()
    await pulsar('familia'); await pulsar('+V1')
    expect(s.st.episodios).toBe(1)
    expect(abierto()).toBe(0)                                         // nunca detrás del modal
    expect(document.querySelector('.overlay')).not.toBeNull()
    await pulsar('cerrar-modal', 40)
    expect(abierto()).toBe(1)
    expect(screen.getByTestId('chat-drawer').getAttribute('data-apertura')).toBe('auto')
  })
  it('8 · cerrar el modal sin episodio nuevo no abre nada', async () => {
    const s = servidor()
    montar(s); await esperar()
    await pulsar('familia'); await pulsar('cerrar-modal', 40)
    expect(abierto()).toBe(0)
  })
  it('9 · respuesta tardía del servidor con el modal todavía abierto → no abre encima; abre al cerrarlo', async () => {
    const s = servidor({ latencia: 30 })
    montar(s); await esperar()
    await pulsar('+P1')                                               // la acción sale sin modal…
    await pulsar('familia')                                           // …y el modal se abre antes de la respuesta
    await esperar(60)
    expect(s.st.episodios).toBe(1); expect(abierto()).toBe(0)
    await pulsar('cerrar-modal', 40)
    expect(abierto()).toBe(1)
  })
  it('10 · la misma confirmación repetida (réplica o doble entrega) no abre dos veces', async () => {
    const s = servidor()
    montar(s); await esperar()
    await pulsar('+P1'); expect(abierto()).toBe(1)
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) }); await esperar()
    await act(async () => { chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:4' }) }); await esperar()
    expect(abierto()).toBe(0)
  })
  it('11 · navegar con un episodio diferido no lo pierde; ir a la pantalla de chat lo da por visto', async () => {
    const s = servidor()
    const v = montar(s); await esperar()
    await pulsar('familia'); await pulsar('+V1')
    srv.screen = 'pedidosdr'; v.rerender(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
    expect(abierto()).toBe(0)
    await pulsar('cerrar-modal', 40)
    expect(abierto()).toBe(1)
    cleanup(); chatUi.reset(); sessionStorage.clear()
    const s2 = servidor()
    const w = montar(s2); await esperar()
    await pulsar('familia'); await pulsar('+V1')
    srv.screen = 'chat_cc'; w.rerender(<><Catalogo carrito={s2.carrito} /><ChatFlotante cliente={s2.chat} intervaloMs={600_000} /></>); await esperar()
    srv.screen = 'catalogo'; w.rerender(<><Catalogo carrito={s2.carrito} /><ChatFlotante cliente={s2.chat} intervaloMs={600_000} /></>); await esperar()
    await pulsar('cerrar-modal', 40)
    expect(abierto()).toBe(0)                                         // ya se vio en la pantalla de chat
  })
  it('12 · cierre manual tras la apertura local: C4 conserva la supresión (la frontera absorbe; no reabre)', async () => {
    const s = servidor()
    montar(s); await esperar()
    await pulsar('+P1'); expect(abierto()).toBe(1)
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) }); await esperar(30)
    expect(abierto()).toBe(0)
    expect(sessionStorage.getItem(claveC4('C1'))).toBe(JSON.stringify({ f: s.st.seq }))   // absorbido por el cierre manual
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await esperar(30)
    expect(abierto()).toBe(0)
  })
  it('13/14/16 · la apertura local no lee historial, no escribe y no llama a la IA; sin episodio no hay apertura ni sesión', async () => {
    const s = servidor()
    montar(s); await esperar()
    await pulsar('-P1'); await pulsar('vaciar')                       // señales débiles
    expect(abierto()).toBe(0); expect(s.st.episodios).toBe(0)
    await pulsar('+P1'); await esperar(20)
    expect(abierto()).toBe(1)
    expect(s.llamadasChat.filter((a) => !['abrir', 'leer', 'leido'].includes(a))).toEqual([])   // ni enviar, ni sesiones, ni leer_sesion
    expect(s.llamadasChat.filter((a) => a === 'abrir')).toHaveLength(1)                        // solo el montaje del lanzador
  })
  it('15 · en human_assigned el doctor puede escribir: la IA sigue disponible (la tarjeta lo dice)', async () => {
    const s = servidor()
    montar(s); await esperar()
    await pulsar('+P1')
    const ta = await screen.findByLabelText('Escribe tu mensaje') as HTMLTextAreaElement
    expect(ta.disabled).toBe(false)
    expect(screen.getByTestId('chat-modo').textContent).toBe('Avisamos a Lucía · el asistente sigue contigo')
    expect(screen.queryByText(/horario|pronto|en breve/)).toBeNull()   // sin inventar horarios ni tiempos
  })
  it('17 · teléfono/automática: no enfoca el redactor (sin teclado); el foco va al diálogo', async () => {
    const s = servidor()
    montar(s); await esperar()
    await pulsar('+P1'); await esperar(20)
    expect(document.activeElement?.getAttribute('role')).toBe('dialog')
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA')
  })
  it('sin vigilancia permanente: tras abrir el diferido, ya no hay observador activo (el modal siguiente no abre nada)', async () => {
    const s = servidor()
    montar(s); await esperar()
    await pulsar('familia'); await pulsar('+V1'); await pulsar('cerrar-modal', 40)
    expect(abierto()).toBe(1)
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) }); await esperar()
    await pulsar('familia'); await pulsar('cerrar-modal', 40)
    expect(abierto()).toBe(0)
  })
})

// @vitest-environment jsdom
// CHV2-B.1 → CHAT V2-D2 · CONTRATO del episodio comercial en el chat del doctor, de punta a punta en el cliente:
//   mutación canónica del carrito (useCarritoCanonico) → respuesta del servidor con handoff nuevo →
//   chatUiStore → ChatFlotante NO abre el cajón: despierta la lectura y anuncia el saludo de D1 UNA vez.
// El "servidor" falso aplica la regla de CC-7: un solo handoff por carrito (handoff_estado), y
// `ya_en_curso` si ya hay atención humana. Nada se infiere de cantidades ni del estado local.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const srv = vi.hoisted(() => ({ role: 'doctor' as string, screen: 'catalogo' }))
vi.mock('../auth/RoleContext', () => ({ useRole: () => ({ role: srv.role, screen: srv.screen, setScreen: vi.fn(), capabilities: [] }) }))

import { ChatFlotante } from './ChatFlotante'
import { useCarritoCanonico } from '../data/hooks/useCarritoCanonico'
import { ClienteCarrito, type Carrito } from '../data/ops/carrito'
import { ClienteChat, type ModoConversacion } from '../data/ops/chat'
import { chatUi } from '../data/store/chatUiStore'

/** Servidor de carrito con la regla real: handoff solo en vacío → primer artículo y con handoff_estado nulo. */
function servidor(opts: { modoConversacion?: ModoConversacion } = {}) {
  const st = { items: {} as Record<string, number>, rev: 1, handoffEstado: null as null | 'solicitado', handoffs: 0, saludo: false, modo: opts.modoConversacion ?? 'ai_active' as ModoConversacion }
  const proyeccion = (): Carrito => ({ cart_id: 'K1', estado: 'active', rev: st.rev, dueno: 'profile', audiencia: 'verified', puede_precio: true, conversation_id: 'C1', n_items: Object.keys(st.items).length, cantidad_total: Object.values(st.items).reduce((a, b) => a + b, 0), total: { estado: 'vacio' },
    items: Object.entries(st.items).map(([product_id, cantidad]) => ({ product_id, nombre: product_id, presentacion: null, imagen_url: null, cantidad, vendible: true, visible: true, disponibilidad: 'disponible', precio: { estado: 'autorizado', unitario: 1, subtotal: cantidad } })) })
  const mutar = (accion: string, product: string | null, cantidad: number) => {
    const antes = Object.keys(st.items).length
    if (accion === 'agregar' || accion === 'actualizar') st.items[product!] = cantidad
    if (accion === 'quitar') delete st.items[product!]
    if (accion === 'vaciar') st.items = {}
    st.rev += 1
    const despues = Object.keys(st.items).length
    let handoff: Record<string, unknown> | null = null
    if (antes === 0 && despues > 0 && st.handoffEstado === null) {
      st.handoffEstado = 'solicitado'; st.handoffs += 1
      const enCurso = st.modo === 'human_requested' || st.modo === 'human_assigned' || st.modo === 'human_active'
      handoff = enCurso ? { estado: 'solicitado', conversation_id: 'C1', modo: st.modo, ya_en_curso: true } : { estado: 'solicitado', conversation_id: 'C1', modo: 'human_requested', asignado: true }
      if (!enCurso) { st.modo = 'human_requested'; st.saludo = true }   // D1 · el servidor persiste el saludo solo en un episodio nuevo
    }
    return { cart_id: 'K1', accion, qty_antes: 0, qty_despues: cantidad, n_items: despues, rev: st.rev, idempotente: false, handoff }
  }
  const carrito = new ClienteCarrito(async (_fn, { body }) => {
    const a = body.action as string
    if (a === 'abrir' || a === 'ver') return { data: proyeccion(), error: null }
    return { data: mutar(a, (body.product_id as string) ?? null, Number(body.cantidad ?? 0)), error: null }
  }, () => null)
  const chat = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string
    if (a === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: st.modo, nuevo: false }, error: null }
    if (a === 'leer') {
      const msgs = st.saludo ? [{ id: 'm1', seq: 1, actor: 'system', content: 'Registramos tu solicitud…', created_at: 'T', propio: false }, { id: 'm2', seq: 2, actor: 'ai', content: '¡Hola, David! 👋 Veo que te interesa P1. ¿Te gustaría conocer sus características?', created_at: 'T', propio: false }] : []
      return { data: { conversation_id: 'C1', estado: 'abierta', modo: st.modo, rol: 'dueno', ultimo_seq: msgs.length, leido_hasta: 0, mensajes: msgs.filter((m) => m.seq > Number(body.desde_seq ?? 0)),
        sesion: st.saludo ? { id: 'S2', ordinal: 2, estado: 'abierta', origen: 'carrito', first_seq: 1, last_seq: null, opened_at: 'T', closed_at: null, close_reason: null } : null,
        handoff: { origen: st.handoffEstado ? 'carrito' : null, cart_id: 'K1', fuera_horario: null, asignado: true, puede_rechazar: true } }, error: null }
    }
    return { data: { ok: true }, error: null }
  }, () => null)
  return { st, carrito, chat }
}

function Catalogo({ carrito }: { carrito: ClienteCarrito }) {
  const c = useCarritoCanonico(true, carrito)
  return (
    <div>
      <button onClick={() => void c.fijar('P1', (c.qty.P1 ?? 0) + 1)}>+P1</button>
      <button onClick={() => void c.fijar('P2', (c.qty.P2 ?? 0) + 1)}>+P2</button>
      <button onClick={() => void c.fijar('P1', 0)}>quitarP1</button>
      <button onClick={() => void c.vaciar()}>vaciar</button>
      <span data-testid="rev">{c.cart?.rev ?? 0}</span>
    </div>
  )
}

const esperar = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })
const pulsar = async (t: string) => { fireEvent.click(screen.getByText(t)); await esperar() }
const abierto = () => screen.queryAllByTestId('chat-drawer').length
const avisos = () => screen.queryAllByTestId('chat-vista').length
const descartarAviso = async () => { fireEvent.click(screen.getByTestId('chat-vista-cerrar')); await esperar() }
const cerrar = async () => { fireEvent.keyDown(document, { key: 'Escape' }); await esperar() }

beforeEach(() => { cleanup(); chatUi.reset(); sessionStorage.clear(); document.body.classList.remove('chat-open'); srv.role = 'doctor'; srv.screen = 'catalogo' })

describe('episodio comercial en el chat del doctor (V2-D2: notifica, nunca abre)', () => {
  it('A/B · handoff nuevo del primer artículo ⇒ un aviso con el saludo y SIN abrir; re-render no lo duplica', async () => {
    const s = servidor()
    const v = render(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
    expect(abierto()).toBe(0); expect(avisos()).toBe(0)
    await pulsar('+P1')
    expect(abierto()).toBe(0); expect(avisos()).toBe(1)
    expect(screen.getByTestId('chat-vista').textContent).toContain('Asistente Renovacell')
    v.rerender(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
    expect(avisos()).toBe(1); expect(abierto()).toBe(0)
    expect(s.st.handoffs).toBe(1)
  })

  it('C/D/E/F/G · aviso descartado no vuelve: ni cantidad, ni segundo producto, ni quitar, ni vaciar', async () => {
    const s = servidor()
    render(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
    await pulsar('+P1'); expect(avisos()).toBe(1)
    await descartarAviso(); expect(avisos()).toBe(0)
    await pulsar('+P1'); expect(avisos()).toBe(0)         // D · cantidad
    await pulsar('+P2'); expect(avisos()).toBe(0)         // E · segundo producto
    await pulsar('quitarP1'); expect(avisos()).toBe(0)    // F · quitar
    await pulsar('vaciar'); expect(avisos()).toBe(0)      // G · vaciar
    expect(abierto()).toBe(0)
    expect(s.st.handoffs).toBe(1)
  })

  it('H · vaciar → volver a agregar con el handoff ya consumido: sin segundo handoff ni aviso', async () => {
    const s = servidor()
    render(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
    await pulsar('+P1'); await descartarAviso()
    await pulsar('vaciar'); await pulsar('+P1')
    expect(avisos()).toBe(0); expect(abierto()).toBe(0)
    expect(s.st.handoffs).toBe(1)
  })

  it('I · recargar la página no repite el aviso (frontera persistida; el episodio ya quedó marcado)', async () => {
    const s = servidor()
    const v = render(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
    await pulsar('+P1'); expect(avisos()).toBe(1)
    v.unmount(); chatUi.reset()                                  // "recarga": el estado en memoria desaparece
    render(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
    expect(avisos()).toBe(0); expect(abierto()).toBe(0)
    // Y aunque llegara una réplica de la misma señal, el carrito ya se presentó en esta sesión.
    expect(sessionStorage.getItem('rc_chat_handoff_abierto:K1:2')).toBe('1')   // CI-2 · episodio = carrito + rev del servidor
    expect(chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:2' })).toBe(false)
  })

  it('J · una asesoría humana que ya existe no avisa al cargar, y un carrito nuevo trae ya_en_curso (sin saludo, sin aviso)', async () => {
    const s = servidor({ modoConversacion: 'human_active' })
    render(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
    expect(abierto()).toBe(0)
    await pulsar('+P1')
    expect(abierto()).toBe(0); expect(avisos()).toBe(0)
    expect(s.st.handoffs).toBe(1)   // el servidor liga el carrito, pero no es una transición nueva
  })

  it('K · el handoff ocurre mientras el doctor está en otra pantalla del portal ⇒ se avisa ahí, sin abrir', async () => {
    srv.screen = 'pedidosdr'
    const s = servidor()
    render(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
    await pulsar('+P1')
    expect(avisos()).toBe(1); expect(abierto()).toBe(0)
  })

  it('K′ · en la pantalla de chat a página completa no se abre un cajón encima (la solicitud se consume)', async () => {
    srv.screen = 'chat_cc'
    const s = servidor()
    render(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
    await pulsar('+P1')
    expect(abierto()).toBe(0)
    expect(chatUi.getSnapshot()).toBeNull()
  })

  it('L · staff (vendedor/Dirección) nunca recibe el lanzador ni la apertura del doctor', async () => {
    for (const r of ['pos', 'admin', 'warehouse']) {
      cleanup(); chatUi.reset(); sessionStorage.clear(); srv.role = r
      const s = servidor()
      render(<><Catalogo carrito={s.carrito} /><ChatFlotante cliente={s.chat} intervaloMs={600_000} /></>); await esperar()
      await pulsar('+P1')
      expect(screen.queryByTestId('chat-fab')).toBeNull()
      expect(abierto()).toBe(0)
    }
  })
})

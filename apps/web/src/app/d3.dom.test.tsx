// @vitest-environment jsdom
// CHAT V2-D3 · Calidad de la notificación reactiva (sin restaurar la autoapertura): repone la cobertura de las
// suites retiradas (C4/CI-2/CI-3) bajo el contrato "notifica, nunca abre" y prueba lo nuevo de D3: sincronía entre
// pestañas (ping → relectura canónica), retiro de la vista previa ya leída, e instrumentación de latencia con causa.
import React, { useEffect } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import { RoleProvider, useRole } from '../auth/RoleContext'
import { ChatFlotante } from './ChatFlotante'
import { ClienteChat, type Mensaje, type ModoConversacion, type SesionResumen } from '../data/ops/chat'
import { chatUi } from '../data/store/chatUiStore'
import { claveC4 } from '../data/ops/autoapertura'
import { metricasAviso, _limpiarMetricas } from '../data/ops/chatMetricas'
import type { Suscriptor, EstadoCanal } from '../data/ops/chatRealtime'
import fuenteApp from '../App.tsx?raw'
import fuenteAsesorias from '../screens/chat/Asesorias.tsx?raw'
import fuenteCanonico from '../screens/chat/ChatCanonico.tsx?raw'

afterEach(() => { cleanup(); chatUi.reset(); sessionStorage.clear(); _limpiarMetricas(); document.body.innerHTML = ''; document.body.className = ''; vi.restoreAllMocks() })

const srv = { pantalla: 'catalogo' }
function Doctor({ children }: { children: React.ReactNode }) {
  const { setRole, setScreen, role, screen } = useRole()
  useEffect(() => { setRole('doctor') }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (role === 'doctor' && screen !== srv.pantalla) setScreen(srv.pantalla) })
  return role === 'doctor' ? <>{children}</> : null
}
const SA: SesionResumen = { id: 'S2', ordinal: 2, estado: 'abierta', origen: 'carrito', first_seq: 1, last_seq: null, opened_at: 'T', closed_at: null, close_reason: null }
type Fila = [number, Mensaje['actor'], string?, boolean?]
function servidor(init: { conv?: string; mensajes?: Fila[]; leido?: number; modo?: ModoConversacion; sesion?: SesionResumen | null } = {}) {
  const fila = ([seq, actor, content, propio]: Fila): Mensaje => ({ id: 'm' + seq, seq, actor, content: content ?? `${actor} ${seq}`, created_at: new Date(Date.now() - 500).toISOString(), propio: !!propio })
  const st = { conv: init.conv ?? 'C1', modo: init.modo ?? 'ai_active' as ModoConversacion, sesion: init.sesion === undefined ? SA : init.sesion, leido: init.leido ?? 0, mensajes: (init.mensajes ?? []).map(fila) }
  const acciones: string[] = []
  const cliente = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string; acciones.push(a)
    if (a === 'leer') return { data: { conversation_id: st.conv, estado: 'abierta', modo: st.modo, rol: 'dueno', ultimo_seq: st.mensajes.reduce((s, m) => Math.max(s, m.seq), 0), leido_hasta: st.leido, sesion: st.sesion, asesor_nombre: 'Lucía Hernández',
      handoff: { origen: null, cart_id: null, fuera_horario: null, asignado: true, puede_rechazar: false }, mensajes: st.mensajes.filter((m) => m.seq > Number(body.desde_seq ?? 0)) }, error: null }
    if (a === 'abrir') return { data: { conversation_id: st.conv, estado: 'abierta', modo: st.modo, nuevo: false }, error: null }
    if (a === 'leido') { st.leido = Math.max(st.leido, Number(body.seq)); return { data: { ok: true }, error: null } }
    if (a === 'sesiones') return { data: { conversation_id: st.conv, sesiones: [{ id: 'S2', ordinal: 2, estado: 'abierta', origen: 'carrito', opened_at: 'T', closed_at: null, close_reason: null, actual: true, last_activity_at: 'T', n_mensajes: 1, asesor_nombre: null }] }, error: null }
    return { data: { ok: true }, error: null }
  }, () => null)
  return { st, cliente, acciones, llega: (...f: Fila) => { st.mensajes.push(fila(f)) }, lecturas: () => acciones.filter((a) => a === 'leer').length }
}
function canal() {
  const subs: Array<{ conv: string; avisar: () => void; estado?: (e: EstadoCanal) => void; activo: boolean }> = []
  const suscribir: Suscriptor = (conv, avisar, estado) => { const s = { conv, avisar, estado, activo: true }; subs.push(s); return () => { s.activo = false } }
  return { subs, suscribir, emitir: (conv = 'C1') => subs.filter((s) => s.activo && s.conv === conv).forEach((s) => s.avisar()), conectar: () => subs.filter((s) => s.activo).forEach((s) => s.estado?.('listo')), activos: () => subs.filter((s) => s.activo) }
}
const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const cajon = () => screen.queryByTestId('chat-drawer')
const vista = () => screen.queryByTestId('chat-vista')
const montar = (s: ReturnType<typeof servidor>, k: ReturnType<typeof canal>, intervaloMs = 600_000) =>
  render(<RoleProvider><Doctor><ChatFlotante cliente={s.cliente} suscribir={k.suscribir} intervaloMs={intervaloMs} /></Doctor></RoleProvider>)
async function listo(s: ReturnType<typeof servidor>, k: ReturnType<typeof canal>, n = 1) { await waitFor(() => expect(s.lecturas()).toBeGreaterThan(0)); await waitFor(() => expect(k.activos().length).toBe(n)); await esperar(40) }
async function senal(k: ReturnType<typeof canal>, conv = 'C1') { await act(async () => { k.emitir(conv) }); await esperar(200) }
async function abrirYCerrar(como: string) {
  fireEvent.click(screen.getByTestId('chat-fab')); await screen.findByTestId('chat-canonico'); await esperar(60)
  if (como === 'x') fireEvent.click(screen.getByTestId('btn-salir'))
  if (como === 'flecha') fireEvent.click(screen.getByTestId('btn-minimizar'))
  if (como === 'fab') fireEvent.click(screen.getByTestId('chat-fab'))
  if (como === 'fondo') fireEvent.click(screen.getByTestId('chat-drawer'))
  if (como === 'escape') await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
  await waitFor(() => expect(cajon()).toBeNull()); await esperar(80)
}

describe('D3 · cobertura repuesta (notifica, nunca abre)', () => {
  for (const como of ['x', 'flecha', 'fab', 'fondo', 'escape']) {
    it(`C4-13/32 · cierre manual por ${como}: lo existente no se re-anuncia; E2 sí`, async () => {
      srv.pantalla = 'catalogo'
      const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
      montar(s, k); await listo(s, k)
      s.llega(2, 'seller', 'E1'); await senal(k); expect(vista()).toBeTruthy()
      await abrirYCerrar(como)
      await senal(k); expect(vista()).toBeNull()
      s.llega(3, 'seller', 'E2'); await senal(k)
      expect(vista()!.textContent).toContain('E2'); expect(cajon()).toBeNull()
    })
  }
  it('C4-04b / C4-12 · con el chat abierto (también en HISTORIAL) no hay vista previa; lo no visto se absorbe al cerrar', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    fireEvent.click(screen.getByTestId('chat-fab'))
    fireEvent.click(await screen.findByTestId('btn-historial')); await screen.findByTestId('historial')
    s.llega(2, 'seller', 'Mientras veía el historial'); await senal(k)
    expect(vista()).toBeNull(); expect(screen.getByTestId('historial')).toBeTruthy()
    fireEvent.click(screen.getByTestId('btn-salir')); await waitFor(() => expect(cajon()).toBeNull()); await esperar(120)
    await senal(k)
    expect(vista()).toBeNull()                                            // absorbido por el cierre manual
    expect(screen.getByTestId('chat-fab-badge').textContent).toBe('1')    // sigue sin leer (C3 no marcó leído)
  })
  it('C4-14 · cambio de ruta (ida y vuelta) no repite el aviso ya mostrado', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    const v = montar(s, k); await listo(s, k)
    s.llega(2, 'seller', 'E1'); await senal(k); fireEvent.click(screen.getByTestId('chat-vista-cerrar'))
    srv.pantalla = 'pedidosdr'; v.rerender(<RoleProvider><Doctor><ChatFlotante cliente={s.cliente} suscribir={k.suscribir} intervaloMs={600_000} /></Doctor></RoleProvider>); await esperar(80)
    srv.pantalla = 'catalogo'; v.rerender(<RoleProvider><Doctor><ChatFlotante cliente={s.cliente} suscribir={k.suscribir} intervaloMs={600_000} /></Doctor></RoleProvider>); await esperar(80)
    await senal(k); expect(vista()).toBeNull()
  })
  it('C4-16/17 · otra cuenta o conversación no hereda la frontera (su no leído antiguo no se anuncia)', async () => {
    srv.pantalla = 'catalogo'
    sessionStorage.setItem(claveC4('C1'), JSON.stringify({ f: 0 }))
    const s = servidor({ conv: 'C2', mensajes: [[1, 'seller'], [2, 'ai']], leido: 0 }); const k = canal()
    montar(s, k); await listo(s, k)
    await senal(k, 'C2'); expect(vista()).toBeNull()
    expect(sessionStorage.getItem(claveC4('C2'))).toBe('{"f":2}'); expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":0}')
  })
  it('C4-18/29 · 28 · notificar solo LEE: sin abrir extra, sin mutaciones y sin mover el cursor; abrir a mano sí marca leído y no mueve F', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'seller'); await senal(k); expect(vista()).toBeTruthy()
    expect(s.acciones.filter((a) => a !== 'leer')).toEqual(['abrir'])     // ni leido, ni enviar, ni sesiones
    expect(s.st.leido).toBe(1)                                             // 28 · el aviso no marca leído
    const f = sessionStorage.getItem(claveC4('C1'))
    fireEvent.click(screen.getByTestId('chat-fab')); await screen.findByTestId('chat-canonico')
    await waitFor(() => expect(s.st.leido).toBe(2))                        // solo la lectura real lo mueve
    expect(sessionStorage.getItem(claveC4('C1'))).toBe(f)                 // C4-30 · abrir no mueve la frontera
    expect(s.acciones.filter((a) => a === 'abrir')).toHaveLength(1)
  })
  it('CI-3 8 · aviso del sistema en espera de asesor (sys:cola) → sin aviso', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, modo: 'human_requested' }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'system', 'Tu conversación volvió a la cola de asesores.'); await senal(k)
    expect(vista()).toBeNull()
  })
  it('CI-2 4/5 · 14/15 · episodio repetido tras el cierre avisa de nuevo; la misma confirmación repetida no avisa dos veces', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, modo: 'human_assigned' }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'ai', '¡Hola, David! 👋 Veo que te interesa A.')
    await act(async () => { chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:5' }) }); await esperar(80)
    expect(vista()!.textContent).toContain('Veo que te interesa A.')
    fireEvent.click(screen.getByTestId('chat-vista-cerrar'))
    await act(async () => { chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:5' }) }); await esperar(80)
    expect(vista()).toBeNull()                                             // réplica del mismo episodio
    s.llega(3, 'ai', '¡Hola, David! 👋 Veo que te interesa B.')            // episodio nuevo (otra sesión) con su saludo
    await act(async () => { chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:9' }) }); await esperar(80)
    expect(vista()!.textContent).toContain('Veo que te interesa B.'); expect(cajon()).toBeNull()
  })
  it('CI-2 8/11 · cerrar un modal sin actividad no avisa; con aviso diferido, navegar no lo pierde; ir a la pantalla de chat lo da por visto', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    const v = montar(s, k); await listo(s, k)
    let modal = document.createElement('div'); modal.className = 'overlay'; document.body.appendChild(modal)
    await act(async () => { modal.remove() }); await esperar(150)
    expect(vista()).toBeNull()                                             // 8
    modal = document.createElement('div'); modal.className = 'overlay'; document.body.appendChild(modal)
    s.llega(2, 'seller', 'Diferido'); await senal(k); expect(vista()).toBeNull()
    srv.pantalla = 'pedidosdr'; v.rerender(<RoleProvider><Doctor><ChatFlotante cliente={s.cliente} suscribir={k.suscribir} intervaloMs={600_000} /></Doctor></RoleProvider>); await esperar(60)
    await act(async () => { modal.remove() }); await esperar(200)
    expect(vista()!.textContent).toContain('Diferido')                     // 11 · navegar no lo pierde
  })
  it('sin vigilancia permanente: tras mostrar el diferido, otros modales no provocan lecturas', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    let modal = document.createElement('div'); modal.className = 'overlay'; document.body.appendChild(modal)
    s.llega(2, 'seller'); await senal(k)
    await act(async () => { modal.remove() }); await esperar(200); expect(vista()).toBeTruthy()
    const antes = s.lecturas()
    modal = document.createElement('div'); modal.className = 'overlay'; document.body.appendChild(modal)
    await act(async () => { modal.remove() }); await esperar(200)
    expect(s.lecturas()).toBe(antes)
  })
  it('CI-3 · una sola suscripción por conversación sobrevive a abrir/cerrar; la reconexión relee sin repetir avisos', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    await abrirYCerrar('x'); await abrirYCerrar('escape')
    expect(k.activos()).toHaveLength(1)
    const antes = s.lecturas()
    await act(async () => { k.conectar() }); await esperar(200)
    expect(s.lecturas()).toBeGreaterThan(antes); expect(vista()).toBeNull()
  })
  it('C4-21 · alcance: /chat sigue a página completa; Asesorías y ChatCanonico sin lógica de aviso/apertura del lanzador', () => {
    expect(String(fuenteApp)).toMatch(/else if \(esRutaChat\) view = <ChatCanonico \/>/)
    expect(String(fuenteApp)).not.toMatch(/ChatFlotante/)
    expect(String(fuenteAsesorias)).not.toMatch(/autoapertura|chat-vista|abrirAuto/)
    expect(String(fuenteCanonico)).not.toMatch(/autoapertura|abrirAuto|chatMetricas/)
  })
})

describe('D3 · nuevo', () => {
  it('9 · varias pestañas: ambas avisan; abrir en una hace que la otra relea y retire badge y vista previa (sin esperar al sondeo)', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    const a = render(<RoleProvider><Doctor><ChatFlotante cliente={s.cliente} suscribir={k.suscribir} intervaloMs={600_000} /></Doctor></RoleProvider>)
    const b = render(<RoleProvider><Doctor><ChatFlotante cliente={s.cliente} suscribir={k.suscribir} intervaloMs={600_000} /></Doctor></RoleProvider>)
    await listo(s, k, 2)
    s.llega(2, 'seller', 'Para las dos'); await senal(k)
    expect(within(a.container).queryByTestId('chat-vista')).toBeTruthy()
    expect(within(b.container).queryByTestId('chat-vista')).toBeTruthy()
    fireEvent.click(within(a.container).getByTestId('chat-fab'))           // pestaña A abre y lee
    await waitFor(() => expect(s.st.leido).toBe(2))
    await waitFor(() => expect(within(b.container).queryByTestId('chat-vista')).toBeNull(), { timeout: 1500 })
    expect(within(b.container).queryByTestId('chat-fab-badge')).toBeNull()
    expect(within(b.container).queryByTestId('chat-drawer')).toBeNull()
  })
  it('la vista previa se retira si el mensaje ya se leyó (cursor del servidor), aunque no hayan pasado 6 s', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k, 80); await listo(s, k)
    s.llega(2, 'seller', 'Hola'); await senal(k); expect(vista()).toBeTruthy()
    s.st.leido = 2                                                         // leído en otro dispositivo
    await waitFor(() => expect(vista()).toBeNull(), { timeout: 1500 })
  })
  it('latencia: cada aviso registra su causa real (realtime / sondeo / episodio) y tiempos sin contenido', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    const v = montar(s, k); await listo(s, k)
    s.llega(2, 'seller', 'Por Realtime'); await senal(k)
    let m = metricasAviso()
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ seq: 2, via: 'realtime' })
    expect(m[0].senalMs).not.toBeNull(); expect(m[0].internoMs).toBeGreaterThanOrEqual(0); expect(m[0].extremoAExtremoMs).not.toBeNull()
    expect(JSON.stringify(m[0])).not.toContain('Por Realtime')            // sin contenido
    v.unmount()
    const k2 = canal(); montar(s, k2, 60); await listo(s, k2)
    s.llega(3, 'seller', 'Por sondeo')
    await waitFor(() => expect(metricasAviso().some((x) => x.seq === 3)).toBe(true), { timeout: 1500 })
    m = metricasAviso(); expect(m.find((x) => x.seq === 3)!.via).toBe('sondeo')
    expect(m.find((x) => x.seq === 3)!.senalMs).toBeNull()                 // no se atribuye a Realtime
  })
  it('27 · barrido: ningún evento abre el chat (episodio, asesor, IA, se unió, sistema, ráfaga, reconexión, pestañas, sondeo)', async () => {
    srv.pantalla = 'catalogo'
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, modo: 'human_assigned' }); const k = canal()
    montar(s, k, 50); await listo(s, k)
    s.llega(2, 'ai', 'Saludo'); await act(async () => { chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:2' }) }); await esperar(100)
    s.llega(3, 'seller', 'Hola'); await senal(k)
    s.st.modo = 'human_active'; s.llega(4, 'system', 'Lucía se unió a la conversación.'); await senal(k)
    s.llega(5, 'ai', 'IA'); s.llega(6, 'seller', 'Más'); await act(async () => { k.emitir(); k.emitir(); k.conectar() }); await esperar(250)
    await esperar(200)
    expect(cajon()).toBeNull()
    expect(document.body.classList.contains('chat-open')).toBe(false)
  })
})

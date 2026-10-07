// @vitest-environment jsdom
// Chat V2-C4 · auto-apertura reactiva del chat flotante del doctor (C4-01 → C4-32). Servidor falso con el
// contrato real de `leer` (seq monótono, propio, modo, sesión, leido_hasta); registra cada acción para probar
// que abrir el cajón no hace `abrir` ni mutaciones, y que la frontera por conversación vive en sessionStorage.
import React, { useEffect } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { RoleProvider, useRole } from '../auth/RoleContext'
import { ChatFlotante } from './ChatFlotante'
import { ClienteChat, type Mensaje, type ModoConversacion, type SesionResumen } from '../data/ops/chat'
import { chatUi } from '../data/store/chatUiStore'
import { claveC4 } from '../data/ops/autoapertura'
import fuenteApp from '../App.tsx?raw'
import fuenteAsesorias from '../screens/chat/Asesorias.tsx?raw'
import fuenteCanonico from '../screens/chat/ChatCanonico.tsx?raw'

afterEach(() => { cleanup(); chatUi.reset(); sessionStorage.clear(); document.body.innerHTML = ''; document.body.className = '' })

function Doctor({ children, pantalla = 'catalogo' }: { children: React.ReactNode; pantalla?: string }) {
  const { setRole, setScreen, role, screen } = useRole()
  useEffect(() => { setRole('doctor') }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (role === 'doctor' && screen !== pantalla) setScreen(pantalla) }, [role, screen, pantalla, setScreen])
  return role === 'doctor' && screen === pantalla ? <>{children}</> : null
}

const SA: SesionResumen = { id: 'S2', ordinal: 2, estado: 'abierta', origen: 'cliente', first_seq: 1, last_seq: null, opened_at: 'T', closed_at: null, close_reason: null }
const SC: SesionResumen = { ...SA, id: 'S1', ordinal: 1, estado: 'cerrada', last_seq: 99, closed_at: 'T', close_reason: 'asesor_finalizo' }
const MUTANTES = ['abrir', 'enviar', 'solicitar_asesor', 'rechazar_asesor', 'asignar', 'iniciar', 'terminar', 'reanudar_ia', 'cerrar', 'reabrir']

function servidor(init: { conv?: string; mensajes?: Array<[number, Mensaje['actor'], boolean?]>; leido?: number; modo?: ModoConversacion; sesion?: SesionResumen | null } = {}) {
  const st = { conv: init.conv ?? 'C1', modo: init.modo ?? 'ai_active' as ModoConversacion, sesion: init.sesion === undefined ? SA : init.sesion, leido: init.leido ?? 0,
    mensajes: (init.mensajes ?? []).map(([seq, actor, propio]) => ({ id: 'm' + seq, seq, actor, content: `${actor} ${seq}`, created_at: new Date().toISOString(), propio: !!propio })) as Mensaje[] }
  const llamadas: Array<{ action: string; body: Record<string, unknown> }> = []
  const cliente = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string; llamadas.push({ action: a, body })
    const ult = st.mensajes.reduce((s, m) => Math.max(s, m.seq), 0)
    if (a === 'abrir') return { data: { conversation_id: st.conv, estado: 'abierta', modo: st.modo, nuevo: false }, error: null }
    if (a === 'leer') {
      const desde = Number(body.desde_seq ?? 0)
      return { data: { conversation_id: st.conv, estado: 'abierta', modo: st.modo, rol: 'dueno', ultimo_seq: ult, leido_hasta: st.leido, sesion: st.sesion,
        handoff: { origen: null, cart_id: null, fuera_horario: null, asignado: false, puede_rechazar: false }, mensajes: st.mensajes.filter((m) => m.seq > desde) }, error: null }
    }
    if (a === 'leido') { st.leido = Math.max(st.leido, Number(body.seq)); return { data: { ok: true }, error: null } }
    if (a === 'sesiones') return { data: { conversation_id: st.conv, sesiones: [] }, error: null }
    return { data: { ok: true }, error: null }
  }, () => null)
  const llega = (seq: number, actor: Mensaje['actor'], propio = false) => { st.mensajes.push({ id: 'm' + seq, seq, actor, content: `${actor} ${seq}`, created_at: new Date().toISOString(), propio }) }
  const acciones = () => llamadas.map((l) => l.action)
  return { st, cliente, llamadas, llega, acciones }
}
const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const montar = (s: ReturnType<typeof servidor>, pantalla?: string) => render(<RoleProvider><Doctor pantalla={pantalla}><ChatFlotante cliente={s.cliente} intervaloMs={40} /></Doctor></RoleProvider>)
const cajon = () => screen.queryByTestId('chat-drawer')
async function listo(s: ReturnType<typeof servidor>) { await screen.findByTestId('chat-fab'); await waitFor(() => expect(s.acciones()).toContain('leer')); await esperar(60) }
async function cerrarCon(como: string) {
  if (como === 'x') fireEvent.click(screen.getByTestId('btn-salir'))
  if (como === 'flecha') fireEvent.click(screen.getByTestId('btn-minimizar'))
  if (como === 'fab') fireEvent.click(screen.getByTestId('chat-fab'))
  if (como === 'fondo') fireEvent.click(screen.getByTestId('chat-drawer'))
  if (como === 'escape') await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
  await waitFor(() => expect(cajon()).toBeNull())
}

describe('C4 · auto-apertura reactiva', () => {
  it('C4-01 · no leído antiguo al montar: NO abre; badge sí; línea base guardada', async () => {
    const s = servidor({ mensajes: [[1, 'seller'], [2, 'ai']] })
    montar(s); await listo(s)
    expect(cajon()).toBeNull()
    expect(screen.getByTestId('chat-fab-badge').textContent).toBe('2')
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":2}')
  })
  it('C4-02 / C4-03 · E1 del asesor con el cajón cerrado → UNA apertura automática; el mismo E1 no reabre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    s.llega(2, 'seller')
    await waitFor(() => expect(cajon()).toBeTruthy())
    expect(cajon()!.getAttribute('data-apertura')).toBe('auto')
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":2}')
    expect(screen.getAllByTestId('chat-canonico')).toHaveLength(1)
  })
  it('C4-04 / C4-05 · cierre manual suprime E1 (aunque siga sin leer); E2 nuevo reabre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    s.llega(2, 'seller')
    await waitFor(() => expect(cajon()).toBeTruthy())
    s.st.leido = 1                                   // E1 sigue "sin leer" en el servidor
    await cerrarCon('x')
    await esperar(200)
    expect(cajon()).toBeNull()
    s.llega(3, 'seller')
    await waitFor(() => expect(cajon()).toBeTruthy())
  })
  it('C4-04b · lo que llegó con el cajón abierto y SIN verse (p. ej. en HISTORIAL) queda suprimido al cerrar a mano', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    fireEvent.click(screen.getByTestId('chat-fab'))
    fireEvent.click(await screen.findByTestId('btn-historial'))
    await screen.findByTestId('historial')
    s.llega(2, 'seller'); await esperar(60)          // en HISTORIAL no se marca leído (C3)
    expect(s.st.leido).toBe(1)
    await cerrarCon('x'); await esperar(200)
    expect(cajon()).toBeNull()                       // E1 ya se "descartó" con el cierre manual
    expect(screen.getByTestId('chat-fab-badge').textContent).toBe('1')   // el badge lo conserva
    s.llega(3, 'ai')
    await waitFor(() => expect(cajon()).toBeTruthy())
  })
  it('C4-06 / C4-07 · respuesta nueva de IA abre una vez; repetida no', async () => {
    const s = servidor({ mensajes: [[1, 'doctor', true]], leido: 1 })
    montar(s); await listo(s)
    s.llega(2, 'ai')
    await waitFor(() => expect(cajon()).toBeTruthy())
    await cerrarCon('x'); await esperar(200)
    expect(cajon()).toBeNull()
  })
  it('C4-08 · aviso del sistema con atención humana activa ("se unió") abre una vez', async () => {
    const s = servidor({ mensajes: [[1, 'doctor', true]], leido: 1, modo: 'human_requested' })
    montar(s); await listo(s)
    s.st.modo = 'human_active'; s.llega(2, 'system')
    await waitFor(() => expect(cajon()).toBeTruthy())
  })
  it('C4-09 / C4-10 · cursor, asignación, cambio de modo, cola o aviso propio → silencio', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 0, modo: 'human_requested' })
    montar(s); await listo(s)
    s.st.leido = 1; await esperar(120)
    s.st.modo = 'human_assigned'; await esperar(120)
    s.llega(2, 'system'); await esperar(120)          // p. ej. sys:cola en espera de asesor
    s.llega(3, 'doctor', true); await esperar(120)
    expect(cajon()).toBeNull()
  })
  it('C4-11 · con el cajón abierto (CURRENT) no hay apertura redundante ni sondeo de la burbuja', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    fireEvent.click(screen.getByTestId('chat-fab'))
    await screen.findByTestId('chat-canonico'); await esperar(60)
    const leerAntes = s.acciones().filter((a) => a === 'leer').length
    s.llega(2, 'seller'); await esperar(250)
    expect(s.acciones().filter((a) => a === 'leer').length).toBe(leerAntes)   // 6 intervalos de burbuja: ninguna lectura
    expect(screen.getAllByTestId('chat-drawer')).toHaveLength(1)
    expect(cajon()!.getAttribute('data-apertura')).toBe('manual')
  })
  it('C4-12 · en HISTORIAL la burbuja no evalúa: el cajón sigue en el historial (el aviso es de C3)', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    fireEvent.click(screen.getByTestId('chat-fab'))
    fireEvent.click(await screen.findByTestId('btn-historial'))
    await screen.findByTestId('historial')
    s.llega(2, 'seller'); await esperar(250)
    expect(screen.getByTestId('historial')).toBeTruthy()
    expect(screen.getAllByTestId('chat-drawer')).toHaveLength(1)
  })
  for (const como of ['x', 'flecha', 'fab', 'fondo', 'escape']) {
    it(`C4-13 / C4-32 · cierre manual por ${como}: suprime E1 y el siguiente E2 restaura`, async () => {
      const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
      montar(s); await listo(s)
      s.llega(2, 'seller')
      await waitFor(() => expect(cajon()).toBeTruthy())
      s.st.leido = 1
      await cerrarCon(como); await esperar(150)
      expect(cajon()).toBeNull()
      s.llega(3, 'ai')
      await waitFor(() => expect(cajon()).toBeTruthy())
    })
  }
  it('C4-14 · cierre manual + cambio de ruta (ida y vuelta) con E1 → no reabre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    const v = montar(s); await listo(s)
    s.llega(2, 'seller')
    await waitFor(() => expect(cajon()).toBeTruthy())
    s.st.leido = 1
    await cerrarCon('x'); await esperar(120)
    v.unmount()
    montar(s, 'pedidosdr'); await listo(s); await esperar(150)
    expect(cajon()).toBeNull()
  })
  it('C4-15 · cierre manual + recarga (remontaje con el mismo sessionStorage) → no reabre E1', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    const v = montar(s); await listo(s)
    s.llega(2, 'seller')
    await waitFor(() => expect(cajon()).toBeTruthy())
    s.st.leido = 1
    await cerrarCon('escape'); await esperar(120)
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":2}')
    v.unmount(); chatUi.reset()
    montar(s); await listo(s); await esperar(150)
    expect(cajon()).toBeNull()
    s.llega(3, 'seller')
    await waitFor(() => expect(cajon()).toBeTruthy())   // lo nuevo tras la recarga sí abre
  })
  it('C4-16 / C4-17 · otra identidad/conversación no hereda la frontera', async () => {
    sessionStorage.setItem(claveC4('C1'), JSON.stringify({ f: 0 }))   // si se heredara, todo sería "nuevo"
    const s = servidor({ conv: 'C2', mensajes: [[1, 'seller'], [2, 'ai']] })
    montar(s); await listo(s)
    expect(cajon()).toBeNull()                                        // línea base propia de C2
    expect(sessionStorage.getItem(claveC4('C2'))).toBe('{"f":2}')
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":0}')
  })
  it('C4-18 / C4-28 / C4-29 · con 0 sesiones abiertas, la auto-apertura solo LEE: sin `abrir` extra ni mutaciones', async () => {
    const s = servidor({ mensajes: [[1, 'ai'], [2, 'system']], leido: 2, sesion: { ...SC, last_seq: 2 } })
    montar(s); await listo(s)
    expect(s.acciones().filter((a) => a === 'abrir')).toHaveLength(1)   // montaje del lanzador (previo a C4)
    s.st.sesion = SA; s.llega(3, 'seller')                              // la sesión 2 la abrió el SERVIDOR con el mensaje
    await waitFor(() => expect(cajon()).toBeTruthy())
    await screen.findByTestId('chat-canonico'); await esperar(80)
    expect(s.acciones().filter((a) => a === 'abrir')).toHaveLength(1)   // el cajón usa la conversación conocida
    expect(s.acciones().filter((a) => MUTANTES.includes(a) && a !== 'abrir')).toEqual([])
    expect(s.llamadas.filter((l) => l.action === 'leer' && l.body.conversation_id === 'C1').length).toBeGreaterThan(1)
  })
  it('C4-28 · abrir el cajón a mano tampoco llama `abrir` otra vez', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    fireEvent.click(screen.getByTestId('chat-fab'))
    await screen.findByTestId('chat-canonico'); await esperar(80)
    expect(s.acciones().filter((a) => a === 'abrir')).toHaveLength(1)
  })
  it('C4-19 · mensajes de una sesión CERRADA (IA tardía, fin, inactividad) → silencio', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, sesion: SC })
    montar(s); await listo(s)
    s.llega(2, 'ai'); s.llega(3, 'system'); await esperar(200)
    expect(cajon()).toBeNull()
  })
  it('C4-20 · varios elegibles en una lectura → una apertura; F al máximo', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    s.llega(2, 'seller'); s.llega(3, 'ai'); s.llega(4, 'seller')
    await waitFor(() => expect(cajon()).toBeTruthy())
    expect(screen.getAllByTestId('chat-drawer')).toHaveLength(1)
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":4}')
  })
  it('C4-22 / C4-31 · apertura automática: foco en el diálogo, NUNCA en el redactor (sin teclado en móvil)', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    s.llega(2, 'seller')
    await waitFor(() => expect(cajon()).toBeTruthy())
    await screen.findByTestId('chat-canonico'); await esperar(80)
    expect(document.activeElement?.getAttribute('role')).toBe('dialog')
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA')
  })
  it('C4-30 · apertura manual: enfoca el redactor y NO mueve la frontera', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    const antes = sessionStorage.getItem(claveC4('C1'))
    fireEvent.click(screen.getByTestId('chat-fab'))
    await screen.findByTestId('chat-canonico')
    await waitFor(() => expect(document.activeElement?.tagName).toBe('TEXTAREA'))
    expect(cajon()!.getAttribute('data-apertura')).toBe('manual')
    expect(sessionStorage.getItem(claveC4('C1'))).toBe(antes)
  })
  it('C4-23 · modal/hoja abierta o campo enfocado → difiere; al quitarse, el siguiente tick abre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    const modal = document.createElement('div'); modal.className = 'overlay'; document.body.appendChild(modal)
    s.llega(2, 'seller'); await esperar(200)
    expect(cajon()).toBeNull()
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":1}')   // diferir no consume la frontera
    modal.remove()
    const campo = document.createElement('input'); document.body.appendChild(campo); campo.focus()
    await esperar(200)
    expect(cajon()).toBeNull()
    campo.blur(); campo.remove()
    await waitFor(() => expect(cajon()).toBeTruthy())
  })
  it('C4-23 · pestaña oculta → no abre; al volver visible, abre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 })
    montar(s); await listo(s)
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    s.llega(2, 'seller'); await esperar(200)
    expect(cajon()).toBeNull()
    if (desc) Object.defineProperty(document, 'visibilityState', desc); else delete (document as unknown as Record<string, unknown>).visibilityState
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(cajon()).toBeTruthy())
  })
  it('C4-26 · V2-A (handoff del carrito) abre por la misma autoridad, sin enfocar el redactor', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, modo: 'human_requested' })
    montar(s); await listo(s)
    await act(async () => { chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1' }) })
    expect(await screen.findByTestId('chat-drawer')).toBeTruthy()
    expect(cajon()!.getAttribute('data-apertura')).toBe('auto')
    expect(sessionStorage.getItem('rc_chat_handoff_abierto:K1')).toBe('1')
    expect(chatUi.getSnapshot()).toBeNull()
  })
  it('C4-27 · V2-A bajo un modal crítico se difiere y abre al cerrarse el modal (siguiente tick)', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, modo: 'human_requested' })
    montar(s); await listo(s)
    const modal = document.createElement('div'); modal.className = 'overlay'; document.body.appendChild(modal)
    await act(async () => { chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K7' }) })
    await esperar(150)
    expect(cajon()).toBeNull()
    expect(chatUi.getSnapshot()).toBeNull()                       // consumida del store; pendiente en el lanzador
    expect(sessionStorage.getItem('rc_chat_handoff_abierto:K7')).toBeNull()
    modal.remove()
    await waitFor(() => expect(cajon()).toBeTruthy())
    expect(sessionStorage.getItem('rc_chat_handoff_abierto:K7')).toBe('1')
  })
  it('C4-21 / staff · alcance: /chat sigue siendo ChatCanonico a página completa; Asesorías y ChatCanonico sin auto-apertura', () => {
    expect(String(fuenteApp)).toMatch(/else if \(esRutaChat\) view = <ChatCanonico \/>/)
    expect(String(fuenteApp)).not.toMatch(/ChatFlotante/)
    expect(String(fuenteAsesorias)).not.toMatch(/autoapertura/)
    expect(String(fuenteCanonico)).not.toMatch(/autoapertura|abrirAuto/)
  })
  it('C4-01 (staff) · el lanzador no existe para Dirección: nada que auto-abrir', async () => {
    const s = servidor({ mensajes: [[1, 'seller']] })
    function Dir({ children }: { children: React.ReactNode }) {
      const { setRole, role } = useRole()
      useEffect(() => { setRole('admin') }, [])   // eslint-disable-line react-hooks/exhaustive-deps
      return role === 'admin' ? <>{children}<span data-testid="listo" /></> : null
    }
    render(<RoleProvider><Dir><ChatFlotante cliente={s.cliente} intervaloMs={40} /></Dir></RoleProvider>)
    await screen.findByTestId('listo'); await esperar(120)
    expect(screen.queryByTestId('chat-fab')).toBeNull()
    expect(s.acciones()).toEqual([])
  })
})

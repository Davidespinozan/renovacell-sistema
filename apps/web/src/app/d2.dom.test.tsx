// @vitest-environment jsdom
// CHAT V2-D2 · Chat flotante NO intrusivo: ningún episodio ni mensaje abre el chat; se NOTIFICA (pulso único, badge
// con el cursor del servidor, vista previa ~6 s con remitente y fragmento seguro). Reúne la cobertura de C4/CI-2/CI-3
// que no dependía de abrir (frontera, supresión, recarga, identidad, sesión cerrada, diferido y vigilancia temporal,
// lectura única en vuelo, agrupado de ráfagas, canal Realtime y limpieza, sin `abrir` extra).
import React, { useEffect } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { RoleProvider, useRole } from '../auth/RoleContext'
import { ChatFlotante, fragmentoSeguro, remitenteDe, DURACION_VISTA_MS, TEXTO_GENERICO } from './ChatFlotante'
import { ClienteChat, type Mensaje, type ModoConversacion, type SesionResumen } from '../data/ops/chat'
import { chatUi } from '../data/store/chatUiStore'
import { claveC4 } from '../data/ops/autoapertura'
import type { Suscriptor, EstadoCanal } from '../data/ops/chatRealtime'

afterEach(() => { cleanup(); chatUi.reset(); sessionStorage.clear(); document.body.innerHTML = ''; document.body.className = ''; vi.restoreAllMocks() })

function Doctor({ children, pantalla = 'catalogo' }: { children: React.ReactNode; pantalla?: string }) {
  const { setRole, setScreen, role, screen } = useRole()
  useEffect(() => { setRole('doctor') }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (role === 'doctor' && screen !== pantalla) setScreen(pantalla) }, [role, screen, pantalla, setScreen])
  return role === 'doctor' && screen === pantalla ? <>{children}</> : null
}

const SA: SesionResumen = { id: 'S2', ordinal: 2, estado: 'abierta', origen: 'carrito', first_seq: 1, last_seq: null, opened_at: 'T', closed_at: null, close_reason: null }
const SC: SesionResumen = { ...SA, id: 'S1', ordinal: 1, estado: 'cerrada', last_seq: 99, closed_at: 'T', close_reason: 'asesor_finalizo' }
type Fila = [number, Mensaje['actor'], string?, boolean?]

function servidor(init: { conv?: string; mensajes?: Fila[]; leido?: number; modo?: ModoConversacion; sesion?: SesionResumen | null; latencia?: number; asesor?: string | null } = {}) {
  const fila = ([seq, actor, content, propio]: Fila): Mensaje => ({ id: 'm' + seq, seq, actor, content: content ?? `${actor} ${seq}`, created_at: new Date().toISOString(), propio: !!propio })
  const st = { conv: init.conv ?? 'C1', modo: init.modo ?? 'ai_active' as ModoConversacion, sesion: init.sesion === undefined ? SA : init.sesion, leido: init.leido ?? 0,
    asesor: init.asesor === undefined ? 'Lucía Hernández' : init.asesor, mensajes: (init.mensajes ?? []).map(fila) }
  const acciones: string[] = []
  const cliente = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string; acciones.push(a)
    if (a === 'leer') {
      const foto = { ...st, mensajes: [...st.mensajes] }
      if (init.latencia) await new Promise((r) => setTimeout(r, init.latencia))
      return { data: { conversation_id: foto.conv, estado: 'abierta', modo: foto.modo, rol: 'dueno', ultimo_seq: foto.mensajes.reduce((s, m) => Math.max(s, m.seq), 0), leido_hasta: foto.leido, sesion: foto.sesion, asesor_nombre: foto.asesor,
        handoff: { origen: null, cart_id: null, fuera_horario: null, asignado: !!foto.asesor, puede_rechazar: false }, mensajes: foto.mensajes.filter((m) => m.seq > Number(body.desde_seq ?? 0)) }, error: null }
    }
    if (a === 'abrir') return { data: { conversation_id: st.conv, estado: 'abierta', modo: st.modo, nuevo: false }, error: null }
    if (a === 'leido') { st.leido = Math.max(st.leido, Number(body.seq)); return { data: { ok: true }, error: null } }
    if (a === 'sesiones') return { data: { conversation_id: st.conv, sesiones: [] }, error: null }
    return { data: { ok: true }, error: null }
  }, () => null)
  const llega = (...f: Fila) => { st.mensajes.push(fila(f)) }
  return { st, cliente, acciones, llega, lecturas: () => acciones.filter((a) => a === 'leer').length }
}
function canal() {
  const subs: Array<{ conv: string; avisar: () => void; estado?: (e: EstadoCanal) => void; activo: boolean }> = []
  const suscribir: Suscriptor = (conv, avisar, estado) => { const s = { conv, avisar, estado, activo: true }; subs.push(s); return () => { s.activo = false } }
  return { subs, suscribir, emitir: (conv = 'C1') => subs.filter((s) => s.activo && s.conv === conv).forEach((s) => s.avisar()), conectar: () => subs.filter((s) => s.activo).forEach((s) => s.estado?.('listo')), activos: () => subs.filter((s) => s.activo) }
}
const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const cajon = () => screen.queryByTestId('chat-drawer')
const vista = () => screen.queryByTestId('chat-vista')
const badge = () => screen.queryByTestId('chat-fab-badge')?.textContent ?? null
const montar = (s: ReturnType<typeof servidor>, k: ReturnType<typeof canal>, intervaloMs = 600_000) =>
  render(<RoleProvider><Doctor><ChatFlotante cliente={s.cliente} suscribir={k.suscribir} intervaloMs={intervaloMs} /></Doctor></RoleProvider>)
async function listo(s: ReturnType<typeof servidor>, k: ReturnType<typeof canal>) { await screen.findByTestId('chat-fab'); await waitFor(() => expect(s.lecturas()).toBeGreaterThan(0)); await waitFor(() => expect(k.activos().length).toBe(1)); await esperar(30) }
async function senal(k: ReturnType<typeof canal>, conv = 'C1') { await act(async () => { k.emitir(conv) }); await esperar(200) }

describe('V2-D2 · notifica, nunca abre', () => {
  it('1/2 · episodio comercial: el saludo de D1 llega como vista previa + badge; el chat NO se abre ni roba el foco', async () => {
    const s = servidor({ mensajes: [[1, 'ai', 'Hola']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    const antes = document.activeElement
    s.st.modo = 'human_assigned'; s.llega(2, 'system', 'Registramos tu solicitud…'); s.llega(3, 'ai', '¡Hola, David! 👋 Veo que te interesa Golden Placenta Mask. ¿Te gustaría conocer sus características o necesitas alguna recomendación?')
    await act(async () => { chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:30' }) }); await esperar(80)
    expect(cajon()).toBeNull()
    expect(vista()!.textContent).toContain('Asistente Renovacell')
    expect(vista()!.textContent).toContain('¡Hola, David! 👋 Veo que te interesa Golden Placenta Mask.')
    expect(badge()).toBe('1')                                            // saludo (el aviso del sistema en espera no cuenta)
    expect(document.activeElement).toBe(antes)                           // sin robar foco (sin teclado en móvil)
    expect(sessionStorage.getItem('rc_chat_handoff_abierto:K1:30')).toBe('1')
  })
  for (const [n, actor, modo, rem] of [['3 · mensaje de Lucía', 'seller', 'human_active', 'Lucía'], ['4 · sys:inicio (Lucía se unió)', 'system', 'human_active', 'Renovacell'], ['5 · respuesta de la IA', 'ai', 'human_assigned', 'Asistente Renovacell']] as const) {
    it(`${n}: vista previa con remitente y pulso, sin abrir`, async () => {
      const s = servidor({ mensajes: [[1, 'doctor', 'Hola', true]], leido: 1, modo: 'human_requested' }); const k = canal()
      montar(s, k); await listo(s, k)
      s.st.modo = modo; s.llega(2, actor, 'Hola doctor, ¿en qué te ayudo?')
      await senal(k)
      expect(cajon()).toBeNull()
      expect(vista()!.textContent).toContain(rem)
      expect(screen.getByTestId('chat-fab').className).toContain('chat-fab--pulso')
    })
  }
  it('6/23 · mensaje propio, o sin sesión abierta → sin aviso', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'doctor', 'Yo', true); await senal(k)
    s.st.sesion = null; s.llega(3, 'ai'); await senal(k)
    expect(vista()).toBeNull(); expect(cajon()).toBeNull()
  })
  it('7 · lo no leído previo al montaje: badge sí, sin vista previa ni pulso', async () => {
    const s = servidor({ mensajes: [[1, 'seller'], [2, 'ai']], leido: 0 }); const k = canal()
    montar(s, k); await listo(s, k)
    expect(badge()).toBe('2'); expect(vista()).toBeNull()
    expect(screen.getByTestId('chat-fab').className).not.toContain('chat-fab--pulso')
  })
  it('24 · sesión cerrada (IA tardía, sys:fin) → sin aviso', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, sesion: SC }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'ai'); s.llega(3, 'system'); await senal(k)
    expect(vista()).toBeNull()
  })
  it('19/22/8 · la burbuja abre a mano (sin `abrir` extra); el badge solo se limpia por el cursor; al cerrar, lo leído no se re-anuncia', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'seller', 'Hola'); await senal(k)
    expect(vista()).toBeTruthy(); expect(badge()).toBe('1')
    fireEvent.click(screen.getByTestId('chat-vista-cerrar')); await esperar(20)
    expect(vista()).toBeNull(); expect(badge()).toBe('1')                 // 21 · ✕ solo quita la vista previa
    fireEvent.click(screen.getByTestId('chat-fab'))
    expect(await screen.findByTestId('chat-canonico')).toBeTruthy()
    await waitFor(() => expect(s.st.leido).toBe(2))                      // 22 · el cursor avanza al ABRIR
    expect(s.acciones.filter((a) => a === 'abrir')).toHaveLength(1)      // C4-28 · conversación conocida
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) }); await esperar(80)
    await senal(k)
    expect(vista()).toBeNull(); expect(cajon()).toBeNull()              // 8
  })
  it('20 · tocar la vista previa abre el chat (acción explícita)', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'seller', 'Hola'); await senal(k)
    fireEvent.click(screen.getByTestId('chat-vista-abrir'))
    expect(await screen.findByTestId('chat-canonico')).toBeTruthy()
    expect(vista()).toBeNull()
  })
  it('9/10 · recargar no repite la vista previa; un mensaje nuevo E2 sí', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    const v = montar(s, k); await listo(s, k)
    s.llega(2, 'seller', 'E1'); await senal(k)
    expect(vista()!.textContent).toContain('E1')
    v.unmount()
    montar(s, k); await waitFor(() => expect(k.activos().length).toBe(1)); await esperar(80)
    await senal(k); expect(vista()).toBeNull()                           // 9
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":2}')
    s.llega(3, 'seller', 'E2'); await senal(k)
    expect(vista()!.textContent).toContain('E2')                         // 10
    expect(cajon()).toBeNull()
  })
  it('11 · Realtime caído o evento perdido: el sondeo avisa igual', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k, 60); await listo(s, k)
    s.llega(2, 'seller', 'Por sondeo')
    await waitFor(() => expect(vista()).toBeTruthy(), { timeout: 1500 })
    expect(cajon()).toBeNull()
  })
  it('12 · ráfaga: UNA vista previa agrupada (último + conteo) y lecturas agrupadas', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    const antes = s.lecturas()
    s.llega(2, 'seller', 'Uno'); s.llega(3, 'seller', 'Dos'); s.llega(4, 'seller', 'Tres')
    await act(async () => { for (let i = 0; i < 6; i++) k.emitir() }); await esperar(250)
    expect(screen.getAllByTestId('chat-vista')).toHaveLength(1)
    expect(vista()!.textContent).toContain('Tres'); expect(vista()!.textContent).toContain('+2')
    expect(s.lecturas() - antes).toBeLessThanOrEqual(2)
  })
  it('13/14/15 · con un modal o el checkout (.overlay): badge sí, vista previa diferida; al cerrarse aparece', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    const modal = document.createElement('div'); modal.className = 'overlay'; document.body.appendChild(modal)
    s.llega(2, 'seller', 'Mientras pagabas'); await senal(k)
    expect(vista()).toBeNull(); expect(badge()).toBe('1'); expect(cajon()).toBeNull()
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":1}')       // diferir no consume la frontera
    await act(async () => { modal.remove() }); await esperar(200)
    expect(vista()!.textContent).toContain('Mientras pagabas')
  })
  it('foco en un campo externo: difiere; al salir del campo aparece (sin tocar el foco)', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    const campo = document.createElement('input'); document.body.appendChild(campo); campo.focus()
    s.llega(2, 'seller', 'Hola'); await senal(k)
    expect(vista()).toBeNull(); expect(document.activeElement).toBe(campo)
    await act(async () => { campo.blur(); campo.remove() }); await esperar(200)
    expect(vista()).toBeTruthy()
  })
  it('16/17 · pestaña oculta: sin lectura ni aviso; al volver visible, reevalúa y avisa', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    const antes = s.lecturas()
    s.llega(2, 'seller'); await senal(k)
    expect(vista()).toBeNull(); expect(s.lecturas()).toBe(antes)
    if (desc) Object.defineProperty(document, 'visibilityState', desc); else delete (document as unknown as Record<string, unknown>).visibilityState
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await esperar(200)
    expect(vista()).toBeTruthy(); expect(cajon()).toBeNull()
  })
  it('18 · con el chat abierto no hay vista previa ni lecturas del lanzador', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    fireEvent.click(screen.getByTestId('chat-fab')); await screen.findByTestId('chat-canonico'); await esperar(50)
    const antes = s.lecturas()
    s.llega(2, 'seller'); await senal(k)
    expect(s.lecturas()).toBe(antes); expect(vista()).toBeNull()
  })
  it('25 · reconexión (SUBSCRIBED de nuevo) relee pero no duplica avisos', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'seller', 'Hola'); await senal(k)
    fireEvent.click(screen.getByTestId('chat-vista-cerrar')); await esperar(20)
    await act(async () => { k.conectar() }); await esperar(200)
    expect(vista()).toBeNull()
  })
  it('26 · otra cuenta/conversación: canal propio, sin fugas; desmontar (logout) lo retira', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    const v = montar(s, k); await listo(s, k)
    v.unmount(); expect(k.activos()).toHaveLength(0)
    const s2 = servidor({ conv: 'C2', mensajes: [[1, 'ai']], leido: 1 })
    montar(s2, k); await listo(s2, k)
    expect(k.activos().map((x) => x.conv)).toEqual(['C2'])
    s.llega(2, 'seller'); await senal(k, 'C1')
    expect(vista()).toBeNull()
  })
  it('señal DURANTE una lectura: no se pierde (relectura al terminar)', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, latencia: 400 }); const k = canal()
    montar(s, k); await listo(s, k); await esperar(450)
    await act(async () => { k.emitir() }); await esperar(140)
    s.llega(2, 'seller', 'Tarde'); await act(async () => { k.emitir() })
    await esperar(200); expect(vista()).toBeNull()
    await waitFor(() => expect(vista()).toBeTruthy(), { timeout: 2000 })
  })
  it('la vista previa dura ~6 s (temporizador) y se reemplaza, no se apila', async () => {
    const espia = vi.spyOn(window, 'setTimeout')
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'seller', 'Uno'); await senal(k)
    expect(espia.mock.calls.some(([, ms]) => ms === DURACION_VISTA_MS)).toBe(true)
    expect(DURACION_VISTA_MS).toBe(6000)
    s.llega(3, 'seller', 'Dos'); await senal(k)
    expect(screen.getAllByTestId('chat-vista')).toHaveLength(1); expect(vista()!.textContent).toContain('Dos')
  })
  it('28 · accesibilidad: zona aria-live siempre montada; acciones con nombre; sin overlay', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    const zona = screen.getByTestId('chat-vista-zona')
    expect(zona.getAttribute('aria-live')).toBe('polite')
    s.llega(2, 'seller', 'Hola'); await senal(k)
    expect(screen.getByTestId('chat-vista-abrir').getAttribute('aria-label')).toMatch(/^Abrir la conversación\. Lucía: Hola/)
    expect(screen.getByTestId('chat-vista-cerrar').getAttribute('aria-label')).toBe('Descartar aviso')
    expect(document.querySelector('.overlay, .chat-drawer-wrap')).toBeNull()
  })
})

describe('fragmento y remitente', () => {
  it('fragmento seguro: ~90 caracteres por puntos de código; enlaces, correos o números largos → genérico', () => {
    const largo = 'a'.repeat(120)
    expect(fragmentoSeguro(largo)).toHaveLength(90)
    expect(fragmentoSeguro(largo)!.endsWith('…')).toBe(true)
    expect(fragmentoSeguro('¡Hola, David! 👋\nVeo que te interesa')).toBe('¡Hola, David! 👋 Veo que te interesa')
    expect(fragmentoSeguro('Paga en https://x.mx/p')).toBeNull()
    expect(fragmentoSeguro('Escríbeme a ventas@renovacell.mx')).toBeNull()
    expect(fragmentoSeguro('Mi CLABE es 012 180 0123 4567 89')).toBeNull()
    expect(fragmentoSeguro('   ')).toBeNull()
    expect(TEXTO_GENERICO).toBe('Tienes un mensaje nuevo.')
  })
  it('remitente: asesora por primer nombre; IA = Asistente Renovacell; sistema/Dirección = Renovacell', () => {
    expect(remitenteDe({ actor: 'seller' }, 'Lucía Hernández · Ventas')).toBe('Lucía')
    expect(remitenteDe({ actor: 'seller' }, null)).toBe('Tu asesora')
    expect(remitenteDe({ actor: 'ai' }, 'x')).toBe('Asistente Renovacell')
    expect(remitenteDe({ actor: 'admin' }, 'x')).toBe('Renovacell')
  })
})

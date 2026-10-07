// @vitest-environment jsdom
// Commercial Intent · CI-3 · Realtime solo DESPIERTA la lectura canónica del lanzador (C4 decide). Canal falso
// inyectado; el sondeo se pone en 10 min para que el único despertador sea Realtime (salvo en las pruebas de
// respaldo). La autorización real del canal (RLS) se prueba en BD: supabase/tests/db/tests/ci3_00_realtime.sql.
import React, { useEffect } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { RoleProvider, useRole } from '../auth/RoleContext'
import { ChatFlotante } from './ChatFlotante'
import { ClienteChat, type Mensaje, type ModoConversacion, type SesionResumen } from '../data/ops/chat'
import { chatUi } from '../data/store/chatUiStore'
import { claveC4 } from '../data/ops/autoapertura'
import type { Suscriptor, EstadoCanal } from '../data/ops/chatRealtime'

afterEach(() => { cleanup(); chatUi.reset(); sessionStorage.clear(); document.body.innerHTML = ''; document.body.className = '' })

function Doctor({ children, pantalla = 'catalogo' }: { children: React.ReactNode; pantalla?: string }) {
  const { setRole, setScreen, role, screen } = useRole()
  useEffect(() => { setRole('doctor') }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (role === 'doctor' && screen !== pantalla) setScreen(pantalla) }, [role, screen, pantalla, setScreen])
  return role === 'doctor' && screen === pantalla ? <>{children}</> : null
}

const SA: SesionResumen = { id: 'S2', ordinal: 2, estado: 'abierta', origen: 'cliente', first_seq: 1, last_seq: null, opened_at: 'T', closed_at: null, close_reason: null }
const SC: SesionResumen = { ...SA, id: 'S1', ordinal: 1, estado: 'cerrada', last_seq: 99, closed_at: 'T', close_reason: 'asesor_finalizo' }

function servidor(init: { conv?: string; mensajes?: Array<[number, Mensaje['actor'], boolean?]>; leido?: number; modo?: ModoConversacion; sesion?: SesionResumen | null; latencia?: number } = {}) {
  const st = { conv: init.conv ?? 'C1', modo: init.modo ?? 'ai_active' as ModoConversacion, sesion: init.sesion === undefined ? SA : init.sesion, leido: init.leido ?? 0,
    mensajes: (init.mensajes ?? []).map(([seq, actor, propio]) => ({ id: 'm' + seq, seq, actor, content: '', created_at: new Date().toISOString(), propio: !!propio })) as Mensaje[] }
  const acciones: string[] = []
  const cliente = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string; acciones.push(a)
    if (a === 'leer') {
      const foto = { ...st, mensajes: [...st.mensajes] }   // estado al INICIO de la lectura
      if (init.latencia) await new Promise((r) => setTimeout(r, init.latencia))
      const ult = foto.mensajes.reduce((s, m) => Math.max(s, m.seq), 0)
      return { data: { conversation_id: foto.conv, estado: 'abierta', modo: foto.modo, rol: 'dueno', ultimo_seq: ult, leido_hasta: foto.leido, sesion: foto.sesion,
        handoff: { origen: null, cart_id: null, fuera_horario: null, asignado: false, puede_rechazar: false }, mensajes: foto.mensajes.filter((m) => m.seq > Number(body.desde_seq ?? 0)) }, error: null }
    }
    if (a === 'abrir') return { data: { conversation_id: st.conv, estado: 'abierta', modo: st.modo, nuevo: false }, error: null }
    if (a === 'leido') { st.leido = Math.max(st.leido, Number(body.seq)); return { data: { ok: true }, error: null } }
    if (a === 'sesiones') return { data: { conversation_id: st.conv, sesiones: [] }, error: null }
    return { data: { ok: true }, error: null }
  }, () => null)
  const llega = (seq: number, actor: Mensaje['actor'], propio = false) => { st.mensajes.push({ id: 'm' + seq, seq, actor, content: '', created_at: new Date().toISOString(), propio }) }
  return { st, cliente, acciones, llega, lecturas: () => acciones.filter((a) => a === 'leer').length }
}
function canal() {
  const subs: Array<{ conv: string; avisar: () => void; estado?: (e: EstadoCanal) => void; activo: boolean }> = []
  const suscribir: Suscriptor = (conv, avisar, estado) => { const s = { conv, avisar, estado, activo: true }; subs.push(s); return () => { s.activo = false } }
  const emitir = (conv = 'C1') => subs.filter((s) => s.activo && s.conv === conv).forEach((s) => s.avisar())
  const conectar = () => subs.filter((s) => s.activo).forEach((s) => s.estado?.('listo'))
  return { subs, suscribir, emitir, conectar, activos: () => subs.filter((s) => s.activo) }
}
const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const cajon = () => screen.queryByTestId('chat-drawer')
const montar = (s: ReturnType<typeof servidor>, k: ReturnType<typeof canal>, intervaloMs = 600_000) =>
  render(<RoleProvider><Doctor><ChatFlotante cliente={s.cliente} suscribir={k.suscribir} intervaloMs={intervaloMs} /></Doctor></RoleProvider>)
async function listo(s: ReturnType<typeof servidor>, k: ReturnType<typeof canal>) { await screen.findByTestId('chat-fab'); await waitFor(() => expect(s.lecturas()).toBeGreaterThan(0)); await waitFor(() => expect(k.activos().length).toBe(1)); await esperar(30) }
async function senal(k: ReturnType<typeof canal>, conv = 'C1') { await act(async () => { k.emitir(conv) }); await esperar(200) }

describe('CI-3 · Realtime despierta a C4', () => {
  for (const [n, actor, modo] of [['1 · mensaje nuevo de Lucía', 'seller', 'human_active'], ['2 · Lucía se une (sys:inicio)', 'system', 'human_active'], ['3 · respuesta nueva de la IA', 'ai', 'human_assigned']] as const) {
    it(`${n}: la señal abre al instante (sin sondeo)`, async () => {
      const s = servidor({ mensajes: [[1, 'doctor', true]], leido: 1, modo: 'human_requested' }); const k = canal()
      montar(s, k); await listo(s, k)
      s.st.modo = modo; s.llega(2, actor)
      await senal(k)
      expect(cajon()).toBeTruthy()
      expect(cajon()!.getAttribute('data-apertura')).toBe('auto')
      expect(document.activeElement?.tagName).not.toBe('TEXTAREA')   // C4-22: sin teclado
    })
  }
  it('4/27 · mensaje propio o señal sin mensajes nuevos → no abre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    await senal(k)
    s.llega(2, 'doctor', true); await senal(k)
    expect(cajon()).toBeNull()
  })
  it('5 · histórico: lo no leído previo al montaje no abre aunque llegue una señal', async () => {
    const s = servidor({ mensajes: [[1, 'seller'], [2, 'ai']], leido: 0 }); const k = canal()
    montar(s, k); await listo(s, k)
    await senal(k)
    expect(cajon()).toBeNull()
    expect(screen.getByTestId('chat-fab-badge').textContent).toBe('2')
  })
  it('6/7 · sesión cerrada (IA tardía, sys:fin) → no abre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, sesion: SC }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'ai'); s.llega(3, 'system'); await senal(k)
    expect(cajon()).toBeNull()
  })
  it('8 · sys:cola (sistema en espera de asesor) → no abre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, modo: 'human_requested' }); const k = canal()
    montar(s, k); await listo(s, k)
    s.llega(2, 'system'); await senal(k)
    expect(cajon()).toBeNull()
  })
  it('9/10/11 · cierre manual suprime E1 (también tras recargar); E2 nuevo abre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    const v = montar(s, k); await listo(s, k)
    s.llega(2, 'seller'); await senal(k)
    expect(cajon()).toBeTruthy()
    s.st.leido = 1
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) }); await esperar(100)
    await senal(k); expect(cajon()).toBeNull()                         // 9 · E1 no reabre
    v.unmount()
    montar(s, k); await waitFor(() => expect(k.activos().length).toBe(1)); await esperar(60)
    await senal(k); expect(cajon()).toBeNull()                         // 10 · tras recargar sigue suprimido
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":2}')
    s.llega(3, 'seller'); await senal(k)
    expect(cajon()).toBeTruthy()                                       // 11 · E2 abre
  })
  it('12 · ráfaga de señales duplicadas → una apertura y lecturas agrupadas', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    const antes = s.lecturas()
    s.llega(2, 'seller')
    await act(async () => { for (let i = 0; i < 6; i++) k.emitir() }); await esperar(250)
    expect(screen.getAllByTestId('chat-drawer')).toHaveLength(1)
    expect(s.lecturas() - antes).toBeLessThanOrEqual(2)                 // 6 señales → ≤ 1 lectura del lanzador (+ la del cajón)
  })
  it('13/14 · sin Realtime (canal caído o evento perdido) el sondeo recupera la actividad', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k, 60); await listo(s, k)
    s.llega(2, 'seller')                                               // ninguna señal
    await waitFor(() => expect(cajon()).toBeTruthy(), { timeout: 1500 })
  })
  it('15 · reconexión (SUBSCRIBED de nuevo) relee, pero no abre lo antiguo', async () => {
    const s = servidor({ mensajes: [[1, 'seller'], [2, 'ai']], leido: 0 }); const k = canal()
    montar(s, k); await listo(s, k)
    const antes = s.lecturas()
    await act(async () => { k.conectar() }); await esperar(200)
    expect(s.lecturas()).toBeGreaterThan(antes)
    expect(cajon()).toBeNull()
  })
  it('16/17/18 · desmontar (logout) retira el canal; otra cuenta/conversación usa su propio canal sin fugas', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    const v = montar(s, k); await listo(s, k)
    expect(k.activos().map((x) => x.conv)).toEqual(['C1'])
    v.unmount()
    expect(k.activos()).toHaveLength(0)                                // logout = AppShell desmontado
    const s2 = servidor({ conv: 'C2', mensajes: [[1, 'ai']], leido: 1 })
    montar(s2, k); await listo(s2, k)
    expect(k.activos().map((x) => x.conv)).toEqual(['C2'])
    s.llega(2, 'seller'); await senal(k, 'C1')                         // actividad de la cuenta anterior
    expect(cajon()).toBeNull()
  })
  it('19/20 · con un modal abierto difiere; al cerrarlo abre (sin esperar el sondeo)', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    const modal = document.createElement('div'); modal.className = 'overlay'; document.body.appendChild(modal)
    s.llega(2, 'seller'); await senal(k)
    expect(cajon()).toBeNull()
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":1}')     // diferir no consume la frontera
    await act(async () => { modal.remove() }); await esperar(200)
    expect(cajon()).toBeTruthy()
  })
  it('21 · foco en un campo externo difiere; al salir del campo abre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    const campo = document.createElement('input'); document.body.appendChild(campo); campo.focus()
    s.llega(2, 'seller'); await senal(k)
    expect(cajon()).toBeNull()
    await act(async () => { campo.blur(); campo.remove() }); await esperar(200)
    expect(cajon()).toBeTruthy()
  })
  it('22/23 · pestaña oculta: la señal no lee ni abre; al volver visible, reevalúa y abre', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    const antes = s.lecturas()
    s.llega(2, 'seller'); await senal(k)
    expect(cajon()).toBeNull(); expect(s.lecturas()).toBe(antes)
    if (desc) Object.defineProperty(document, 'visibilityState', desc); else delete (document as unknown as Record<string, unknown>).visibilityState
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await esperar(200)
    expect(cajon()).toBeTruthy()
  })
  it('24 · señal que llega DURANTE una lectura: no se pierde (se vuelve a leer al terminar)', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1, latencia: 400 }); const k = canal()
    montar(s, k); await listo(s, k); await esperar(450)
    await act(async () => { k.emitir() }); await esperar(140)        // lectura 1 en vuelo ~120→520 ms (estado sin el mensaje)
    s.llega(2, 'seller'); await act(async () => { k.emitir() })       // su señal cae (tras el agrupado) DENTRO de la lectura 1
    await esperar(200)
    expect(cajon()).toBeNull()                                        // la lectura 1 no lo vio
    await waitFor(() => expect(cajon()).toBeTruthy(), { timeout: 2000 })   // la relectura sí
  })
  it('25 · el despertador no toca el historial (C3): solo leer', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    await senal(k); await senal(k)
    expect(s.acciones.filter((a) => !['abrir', 'leer'].includes(a))).toEqual([])
  })
  it('26 · V2-A/CI-2 sigue abriendo al instante con Realtime activo', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    await act(async () => { chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K1', episodio: 'K1:5' }) })
    expect(await screen.findByTestId('chat-drawer')).toBeTruthy()
  })
  it('con el cajón ABIERTO las señales se ignoran (ChatCanonico ya lee); al cerrarlo, una sola suscripción sigue viva', async () => {
    const s = servidor({ mensajes: [[1, 'ai']], leido: 1 }); const k = canal()
    montar(s, k); await listo(s, k)
    fireEvent.click(screen.getByTestId('chat-fab')); await screen.findByTestId('chat-canonico'); await esperar(50)
    const antes = s.lecturas()
    await senal(k); await senal(k)
    expect(s.lecturas()).toBe(antes)
    expect(k.activos()).toHaveLength(1)
  })
})

// @vitest-environment jsdom
// D4-FIX · cierre del asesor y transición de autorización: Terminar exitoso no relee (el asesor pierde acceso
// por diseño de C1), detiene el sondeo y vuelve a Asesorías con confirmación; la pérdida legítima de acceso de un
// asesor YA autorizado (C2, reasignación, devolución a la cola, cierre desde otra sesión) es un estado neutral, no
// un error; "Terminar" solo en los estados que el backend acepta (human_active / human_ended).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { ChatCanonico, TEXTO_ASESORIA_FINALIZADA, TEXTO_SIN_ASIGNACION } from './ChatCanonico'
import { Asesorias } from './Asesorias'
import type { ClienteChat, Conversacion, ColaItem, ErrorChat } from '../../data/ops/chat'

vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'ventas', setScreen: vi.fn() }) }))
beforeEach(cleanup)

const NO_AUT: ErrorChat = { codigo: 'no_autorizado', mensaje: 'No tienes acceso a esta conversación.' }
const TRANS: ErrorChat = { codigo: 'transicion_invalida', mensaje: 'Esa acción no corresponde al estado actual.' }
const RED: ErrorChat = { codigo: 'red', mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' }
const espera = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

type Resp = { ok: true; data: unknown } | { ok: false; error: ErrorChat }
/** Cliente falso: `leer` responde con la conversación hasta que `perderAcceso()`; `terminar` responde lo configurado. */
function falso(conv: Partial<Conversacion>, opts: { terminar?: Resp; leerInicial?: Resp } = {}) {
  const llamadas: string[] = []
  let sinAcceso = false
  const base = { conversation_id: 'C1', estado: 'abierta', modo: 'human_active', ultimo_seq: 0, mensajes: [], rol: 'asesor', asesor_soy_yo: true, ...conv }
  let primera = true
  const c = {
    leer: async () => {
      llamadas.push('leer')
      if (primera && opts.leerInicial) { primera = false; return opts.leerInicial }
      primera = false
      return sinAcceso ? { ok: false, error: NO_AUT } : { ok: true, data: base }
    },
    terminar: async () => { llamadas.push('terminar'); return opts.terminar ?? { ok: true, data: {} } },
    iniciar: async () => { llamadas.push('iniciar'); return { ok: true, data: {} } },
    liberar: async () => { llamadas.push('liberar'); return { ok: true, data: {} } },
    leido: async () => ({ ok: true, data: {} }), enviar: async () => ({ ok: true, data: {} }),
    cola: async () => { llamadas.push('cola'); return { ok: true, data: { cola: [item] } } },
  } as unknown as ClienteChat
  return { c, llamadas, perderAcceso: () => { sinAcceso = true }, leerTras: (fn: string) => llamadas.slice(llamadas.lastIndexOf(fn) + 1).filter((x) => x === 'leer').length }
}
const item: ColaItem = { conversation_id: 'C1', modo: 'human_active', seller_profile_id: 'L', asesoria_solicitada_at: null, last_message_at: null, es_mia: true, sin_leer: 0, dueno: 'David' }

describe('FIX-G · Terminar exitoso', () => {
  it('ejecuta terminar, NO relee, detiene el sondeo y avisa a quien monta', async () => {
    const f = falso({}); const onFin = vi.fn()
    // Temporizadores vivos con el intervalo del sondeo (37 ms, único): tras terminar deben retirarse, no solo ignorarse.
    const vivos = new Set<unknown>(); const si = globalThis.setInterval; const ci = globalThis.clearInterval
    const spySet = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => { const id = si(fn, ms); if (ms === 37) vivos.add(id); return id }) as typeof setInterval)
    const spyClear = vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id?: ReturnType<typeof setInterval>) => { vivos.delete(id); ci(id) }) as typeof clearInterval)
    render(<ChatCanonico embebido asesor conversationId="C1" cliente={f.c} intervaloMs={37} onFin={onFin} onSalir={vi.fn()} />)
    await screen.findByTestId('btn-terminar')
    expect(vivos.size).toBe(1)
    fireEvent.click(screen.getByTestId('btn-terminar'))
    await waitFor(() => expect(onFin).toHaveBeenCalledWith('terminada'))
    expect(vivos.size).toBe(0)
    spySet.mockRestore(); spyClear.mockRestore()
    f.perderAcceso()   // en el servidor el asesor ya no tiene acceso (seller_profile_id = null)
    await espera(150)
    expect(f.leerTras('terminar')).toBe(0)
    expect(screen.queryByText(NO_AUT.mensaje)).toBeNull()
    expect(screen.getByTestId('aviso-asesoria-finalizada')).toHaveTextContent(TEXTO_ASESORIA_FINALIZADA)
    expect(screen.queryByTestId('btn-terminar')).toBeNull()
  })
  it('en Asesorías: vuelve a la lista con la confirmación neutral, sin el error de acceso', async () => {
    const f = falso({})
    render(<Asesorias cliente={f.c} intervaloMs={60_000} />)
    fireEvent.click(await screen.findByTestId('btn-abrir'))
    fireEvent.click(await screen.findByTestId('btn-terminar'))
    expect(await screen.findByTestId('aviso-apertura')).toHaveTextContent(TEXTO_ASESORIA_FINALIZADA)
    expect(screen.getByTestId('asesorias')).toBeInTheDocument()
    expect(screen.queryByTestId('btn-terminar')).toBeNull()
    expect(screen.queryByText(NO_AUT.mensaje)).toBeNull()
    expect(f.leerTras('terminar')).toBe(0)
    await waitFor(() => expect(f.llamadas.slice(f.llamadas.indexOf('terminar')).includes('cola')).toBe(true))   // la lista se refresca
  })
  it('fallo real de terminar: conserva el error, la conversación y el sondeo', async () => {
    const f = falso({}, { terminar: { ok: false, error: TRANS } }); const onFin = vi.fn()
    render(<ChatCanonico embebido asesor conversationId="C1" cliente={f.c} intervaloMs={20} onFin={onFin} />)
    fireEvent.click(await screen.findByTestId('btn-terminar'))
    expect(await screen.findByText(TRANS.mensaje)).toBeInTheDocument()
    await espera(100)
    expect(onFin).not.toHaveBeenCalled()
    expect(f.leerTras('terminar')).toBeGreaterThan(1)
    expect(screen.queryByTestId('asesoria-fin')).toBeNull(); expect(screen.getByTestId('btn-terminar')).toBeInTheDocument()
  })
  it('fallo de red de terminar: tampoco se toma por éxito', async () => {
    const f = falso({}, { terminar: { ok: false, error: RED } }); const onFin = vi.fn()
    render(<ChatCanonico embebido asesor conversationId="C1" cliente={f.c} intervaloMs={60_000} onFin={onFin} />)
    fireEvent.click(await screen.findByTestId('btn-terminar'))
    expect(await screen.findByText(RED.mensaje)).toBeInTheDocument(); expect(onFin).not.toHaveBeenCalled()
  })
})

describe('FIX-G2 · pérdida legítima de acceso de un asesor ya autorizado', () => {
  it.each(['C2 expiró la solicitud', 'Dirección reasignó', 'Dirección devolvió a la cola', 'otra sesión cerró'])('%s → estado neutral, sin error y sin más lecturas', async () => {
    const f = falso({}); const onSalir = vi.fn()
    render(<ChatCanonico embebido asesor conversationId="C1" cliente={f.c} intervaloMs={20} onSalir={onSalir} />)
    await screen.findByTestId('btn-terminar')
    f.perderAcceso()
    expect(await screen.findByTestId('aviso-sin-asignacion')).toHaveTextContent(TEXTO_SIN_ASIGNACION)
    expect(screen.queryByText(NO_AUT.mensaje)).toBeNull(); expect(screen.queryByTestId('btn-terminar')).toBeNull()
    const n = f.llamadas.filter((x) => x === 'leer').length
    await espera(120)
    expect(f.llamadas.filter((x) => x === 'leer').length).toBe(n)
    fireEvent.click(screen.getByTestId('btn-volver-asesorias'))
    expect(screen.getByTestId('btn-volver-asesorias')).toHaveTextContent('Volver a Asesorías'); expect(onSalir).toHaveBeenCalled()
  })
  it('un 403 en la PRIMERA lectura (nunca autorizado) sigue siendo error, no estado neutral', async () => {
    const f = falso({}, { leerInicial: { ok: false, error: NO_AUT } })
    render(<ChatCanonico embebido asesor conversationId="C1" cliente={f.c} intervaloMs={60_000} />)
    expect(await screen.findByText(NO_AUT.mensaje)).toBeInTheDocument(); expect(screen.queryByTestId('asesoria-fin')).toBeNull()
  })
  it('otro error tras estar autorizado (red) no se convierte en pérdida de acceso', async () => {
    const f = falso({}); let red = false
    const leer = f.c.leer.bind(f.c)
    ;(f.c as unknown as { leer: unknown }).leer = async (...a: unknown[]) => (red ? { ok: false, error: RED } : (leer as (...x: unknown[]) => unknown)(...a))
    render(<ChatCanonico embebido asesor conversationId="C1" cliente={f.c} intervaloMs={20} />)
    await screen.findByTestId('btn-terminar'); red = true
    expect(await screen.findByText(RED.mensaje)).toBeInTheDocument(); expect(screen.queryByTestId('asesoria-fin')).toBeNull()
  })
  it('el doctor (sin `asesor`) no recibe el estado del asesor: un 403 queda como error', async () => {
    const f = falso({ rol: 'dueno', asesor_soy_yo: false, modo: 'ai_active' })
    render(<ChatCanonico conversationId="C1" cliente={f.c} conCarrito={false} intervaloMs={20} />)
    await screen.findByTestId('chat-modo'); f.perderAcceso()
    expect(await screen.findByText(NO_AUT.mensaje)).toBeInTheDocument(); expect(screen.queryByTestId('asesoria-fin')).toBeNull()
  })
  it('Dirección (supervisor) conserva acceso: sigue leyendo y con sus acciones', async () => {
    const f = falso({ rol: 'supervisor', asesor_soy_yo: false })
    render(<ChatCanonico embebido asesor conversationId="C1" cliente={f.c} intervaloMs={20} />)
    await screen.findByTestId('btn-terminar')
    const n = f.llamadas.filter((x) => x === 'leer').length
    await espera(100)
    expect(f.llamadas.filter((x) => x === 'leer').length).toBeGreaterThan(n)
    expect(screen.getByText('Devolver a la cola')).toBeInTheDocument(); expect(screen.queryByTestId('asesoria-fin')).toBeNull()
  })
})

describe('FIX-A · "Terminar asesoría" solo donde el backend lo acepta', () => {
  it.each([
    ['human_assigned', false, true], ['human_active', true, false], ['human_ended', true, false], ['ai_active', false, false], ['human_requested', false, false],
  ] as const)('%s → terminar=%s, iniciar=%s', async (modo, terminar, iniciar) => {
    const f = falso({ modo })
    render(<ChatCanonico embebido asesor conversationId="C1" cliente={f.c} intervaloMs={60_000} />)
    await screen.findByTestId('chat-modo')
    expect(!!screen.queryByTestId('btn-terminar')).toBe(terminar)
    expect(!!screen.queryByTestId('btn-iniciar')).toBe(iniciar)
  })
})

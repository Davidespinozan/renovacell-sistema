// @vitest-environment jsdom
// UX-1 · El lanzador flotante abre la MISMA conversación canónica: solo doctor, nunca sobre la
// pantalla de chat (un solo ChatCanonico montado), badge con el cursor del servidor (leido_hasta).
import React, { useEffect } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { RoleProvider, useRole } from '../auth/RoleContext'
import type { RoleKey } from './roles'
import { ChatFlotante } from './ChatFlotante'
import { ClienteChat } from '../data/ops/chat'

afterEach(cleanup)

function Como({ rol, pantalla, children }: { rol: RoleKey; pantalla: string; children: React.ReactNode }) {
  const { setRole, setScreen, role, screen } = useRole()
  // setRole no es estable (se recrea en cada render del provider): se fija UNA vez; setScreen sí es estable.
  useEffect(() => { setRole(rol) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (role === rol && screen !== pantalla) setScreen(pantalla) }, [role, screen, rol, pantalla, setScreen])
  return role === rol && screen === pantalla ? <>{children}</> : null
}

function clienteFalso(leidoHasta: number, mensajes: Array<{ seq: number; actor: string; propio: boolean }>) {
  const llamadas: string[] = []
  const c = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string; llamadas.push(a)
    if (a === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null }
    if (a === 'leer') {
      const desde = Number(body.desde_seq ?? 0)
      return { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: 4, leido_hasta: leidoHasta, handoff: { origen: null, cart_id: null, fuera_horario: null, asignado: false, puede_rechazar: false },
        mensajes: mensajes.filter((m) => m.seq > desde).map((m) => ({ id: 'm' + m.seq, seq: m.seq, actor: m.actor, content: 'x', created_at: 'T', propio: m.propio })) }, error: null }
    }
    if (a === 'leido') return { data: { ok: true }, error: null }
    if (a === 'ver' || a === 'abrir_carrito') return { data: null, error: { message: 'no' } }
    return { data: null, error: { message: 'accion ' + a } }
  }, () => null)
  return { c, llamadas }
}

describe('ChatFlotante', () => {
  it('3 · aparece para el doctor en Catálogo con etiqueta accesible', async () => {
    const { c } = clienteFalso(0, [])
    render(<RoleProvider><Como rol="doctor" pantalla="catalogo"><ChatFlotante cliente={c} /></Como></RoleProvider>)
    expect(await screen.findByRole('button', { name: /Habla con Renovacell/ })).toBeTruthy()
  })
  it('4 · no aparece para staff ni Dirección', async () => {
    const { c } = clienteFalso(0, [])
    render(<RoleProvider><Como rol="admin" pantalla="av_inv"><ChatFlotante cliente={c} /><span data-testid="listo" /></Como></RoleProvider>)
    await screen.findByTestId('listo')
    expect(screen.queryByTestId('chat-fab')).toBeNull()
  })
  it('5 · en la pantalla de chat (y en el alias asist) el lanzador no existe: un solo ChatCanonico', async () => {
    const { c } = clienteFalso(0, [])
    render(<RoleProvider><Como rol="doctor" pantalla="chat_cc"><ChatFlotante cliente={c} /><span data-testid="listo" /></Como></RoleProvider>)
    await screen.findByTestId('listo')
    expect(screen.queryByTestId('chat-fab')).toBeNull()
  })
  it('12 · el badge cuenta SOLO lo posterior a leido_hasta del servidor, sin propios ni sistema', async () => {
    const { c } = clienteFalso(2, [{ seq: 1, actor: 'ai', propio: false }, { seq: 2, actor: 'ai', propio: false }, { seq: 3, actor: 'doctor', propio: true }, { seq: 4, actor: 'seller', propio: false }, { seq: 5, actor: 'system', propio: false }])
    render(<RoleProvider><Como rol="doctor" pantalla="catalogo"><ChatFlotante cliente={c} /></Como></RoleProvider>)
    expect((await screen.findByTestId('chat-fab-badge')).textContent).toBe('1')
  })
  it('7/8 · abrir monta UNA ChatCanonico con historial, carrito y controles CC-7; cerrar la desmonta y apaga el badge', async () => {
    const { c, llamadas } = clienteFalso(0, [{ seq: 1, actor: 'ai', propio: false }])
    render(<RoleProvider><Como rol="doctor" pantalla="catalogo"><ChatFlotante cliente={c} /></Como></RoleProvider>)
    await screen.findByTestId('chat-fab-badge')
    fireEvent.click(screen.getByTestId('chat-fab'))
    expect(await screen.findByTestId('chat-drawer')).toBeTruthy()
    await waitFor(() => expect(screen.getAllByTestId('chat-canonico').length).toBe(1))
    expect(await screen.findByTestId('msg-ai')).toBeTruthy()
    expect(screen.getByTestId('btn-asesor')).toBeTruthy()          // CC-7 · "Hablar con un asesor"
    expect(screen.queryByTestId('chat-fab-badge')).toBeNull()
    await waitFor(() => expect(llamadas).toContain('leido'))        // marca leído con la semántica canónica
    fireEvent.click(screen.getByTestId('btn-salir'))
    await waitFor(() => expect(screen.queryByTestId('chat-canonico')).toBeNull())
  })
  it('Escape cierra el cajón', async () => {
    const { c } = clienteFalso(0, [])
    render(<RoleProvider><Como rol="doctor" pantalla="pedidosdr"><ChatFlotante cliente={c} /></Como></RoleProvider>)
    fireEvent.click(await screen.findByTestId('chat-fab'))
    await screen.findByTestId('chat-drawer')
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.queryByTestId('chat-drawer')).toBeNull()
    vi.restoreAllMocks()
  })
})

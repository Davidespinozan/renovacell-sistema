// @vitest-environment jsdom
// Chat V2-C1 · el hilo activo es la sesión actual: si el servidor pasa a otra sesión, el chat no mezcla
// los mensajes de la anterior con los de la nueva.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, type Conversacion, type Mensaje } from '../../data/ops/chat'

afterEach(cleanup)
const msg = (seq: number, content: string): Mensaje => ({ id: 'm' + seq, seq, actor: seq % 2 ? 'doctor' : 'ai', content, created_at: new Date(Date.now() - 60_000).toISOString(), propio: seq % 2 === 1 })
const base = (x: Partial<Conversacion>): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: 0, mensajes: [], leido_hasta: 0, ...x })

describe('sesión actual', () => {
  it('al cambiar de sesión el hilo se reemplaza (no se mezclan sesiones)', async () => {
    let fase = 1
    const s1 = base({ ultimo_seq: 2, mensajes: [msg(1, 'Hola ayer'), msg(2, 'Respuesta de ayer')], sesion: { id: 'S1', ordinal: 1, estado: 'abierta', origen: 'cliente', opened_at: 'x', closed_at: null, close_reason: null } })
    const s2 = base({ ultimo_seq: 4, mensajes: [msg(3, 'Hola hoy'), msg(4, 'Respuesta de hoy')], sesion: { id: 'S2', ordinal: 2, estado: 'abierta', origen: 'cliente', opened_at: 'z', closed_at: null, close_reason: null } })
    const cliente = new ClienteChat(async (_fn, { body }) => {
      const a = body.action as string
      if (a === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null }
      if (a === 'leer') { const c = fase === 1 ? s1 : s2; const d = Number(body.desde_seq ?? 0); return { data: { ...c, mensajes: c.mensajes.filter((m) => m.seq > d) }, error: null } }
      return { data: { ok: true }, error: null }
    }, () => null)
    render(<ChatCanonico panel embebido cliente={cliente} conCarrito={false} intervaloMs={40} />)
    expect(await screen.findByText('Respuesta de ayer')).toBeTruthy()
    fase = 2
    await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
    expect(await screen.findByText('Respuesta de hoy')).toBeTruthy()
    expect(screen.queryByText('Respuesta de ayer')).toBeNull()
  })
})

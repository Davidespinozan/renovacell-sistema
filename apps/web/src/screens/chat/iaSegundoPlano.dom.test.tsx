// @vitest-environment jsdom
// PERF · la IA responde en segundo plano: el envío se confirma al instante ('en_curso'), el usuario puede seguir
// escribiendo, el indicador del asistente queda visible y el chat lee seguido hasta que llega su respuesta.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, type Conversacion, type Mensaje } from '../../data/ops/chat'
import chatEdge from '../../../../../supabase/functions/chat/index.ts?raw'

afterEach(cleanup)
const msg = (seq: number, actor: Mensaje['actor'], propio: boolean, content: string): Mensaje => ({ id: `m${seq}`, seq, actor, content, created_at: '2026-10-30T12:00:00Z', propio })

describe('IA en segundo plano', () => {
  it('el mensaje se confirma sin esperar a la IA; el indicador sigue hasta que llega su respuesta', async () => {
    let mensajes: Mensaje[] = []
    let lecturas = 0
    const cliente = new ClienteChat(async (_f, { body }) => {
      if (body.action === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null }
      if (body.action === 'enviar') { mensajes = [msg(1, 'doctor', true, String(body.content))]; return { data: { id: 'm1', seq: 1, idempotente: false, modo: 'ai_active', ia: 'en_curso' }, error: null } }
      if (body.action === 'leer') {
        lecturas++
        const desde = Number(body.desde_seq ?? 0)
        const c: Conversacion = { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: mensajes.length, mensajes: mensajes.filter((m) => m.seq > desde) }
        return { data: c, error: null }
      }
      return { data: { ok: true }, error: null }
    }, () => null)
    render(<ChatCanonico cliente={cliente} conCarrito={false} intervaloMs={600_000} suscribir={null} />)
    const area = await screen.findByLabelText('Escribe tu mensaje') as HTMLTextAreaElement
    await waitFor(() => expect(area.disabled).toBe(false))
    fireEvent.change(area, { target: { value: '¿Tienen Renova Serum?' } })
    fireEvent.click(screen.getByTestId('btn-enviar'))

    // Confirmado: la caja vuelve a estar libre mientras el asistente "escribe".
    await waitFor(() => expect(area.disabled).toBe(false))
    expect(screen.getByTestId('escribiendo')).toBeTruthy()
    const antes = lecturas

    // La respuesta llega (como la insertaría el orquestador) y el sondeo rápido la recoge.
    mensajes = [...mensajes, msg(2, 'ai', false, 'Sí, tenemos Renova Serum.')]
    await waitFor(() => expect(screen.getByText('Sí, tenemos Renova Serum.')).toBeTruthy(), { timeout: 4000 })
    expect(lecturas).toBeGreaterThan(antes)
    await waitFor(() => expect(screen.queryByTestId('escribiendo')).toBeNull())
  })

  it('servidor: el envío no espera al turno de IA', () => {
    const enviar = chatEdge.slice(chatEdge.indexOf("if (action === 'enviar')"), chatEdge.indexOf("if (action === 'adjuntar')"))
    expect(enviar).not.toMatch(/ia = [^\n]*await responderIA/)
    expect(enviar).toMatch(/enSegundoPlano\(\(async \(\) => \{[\s\S]*await responderIA\(/)
  })
})

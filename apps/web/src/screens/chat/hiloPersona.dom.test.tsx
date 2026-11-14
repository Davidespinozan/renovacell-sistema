// @vitest-environment jsdom
// HILO-PERSONA (14 nov 2026) · la misma persona por WhatsApp y portal: UN hilo con el canal de cada mensaje y
// "Responder por" para elegir por dónde sale la respuesta (por defecto, por donde escribió la última vez).
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat } from '../../data/ops/chat'
import type { HiloPersona } from '../../data/ops/hiloPersona'

afterEach(cleanup)
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

function montar() {
  const enviados: Array<{ conv: string; texto: string }> = []
  const c = new ClienteChat(async (_f, { body }) => {
    if (body.action === 'leer') return { data: { conversation_id: 'PORTAL', estado: 'abierta', modo: 'human_active', rol: 'asesor', asesor_soy_yo: true, ultimo_seq: 1,
      mensajes: [{ id: 'p1', seq: 1, actor: 'doctor', content: 'Hola desde el portal', created_at: hace(30), propio: false }] }, error: null }
    if (body.action === 'enviar') { enviados.push({ conv: String(body.conversation_id), texto: String(body.content) }); return { data: { id: 'n', seq: 9, idempotente: false, modo: 'human_active', ia: 'silenciada' }, error: null } }
    return { data: { ok: true }, error: null }
  }, () => null)
  const hilo = async (): Promise<HiloPersona> => ({ persona: 'P1', conversaciones: [
    { conversation_id: 'WA', canal: 'whatsapp', modo: 'human_active', last_message_at: hace(5), actual: false },
    { conversation_id: 'PORTAL', canal: 'portal', modo: 'human_active', last_message_at: hace(30), actual: true }],
    mensajes: [{ id: 'w1', seq: 4, actor: 'visitor', content: 'Y ahora por WhatsApp', created_at: hace(5), propio: false, conversation_id: 'WA', canal: 'whatsapp' }] })
  render(<ChatCanonico asesor embebido conversationId="PORTAL" cliente={c} conCarrito={false} respuestas={null} suscribir={null} intervaloMs={600_000} hiloDePersona={hilo} />)
  return { enviados }
}

describe('Hilo por persona', () => {
  it('muestra los dos canales en UN hilo, en orden y con su etiqueta', async () => {
    montar()
    expect(await screen.findByText('Y ahora por WhatsApp')).toBeTruthy()
    const texto = screen.getByTestId('chat-canonico').textContent ?? ''
    expect(texto.indexOf('Hola desde el portal')).toBeLessThan(texto.indexOf('Y ahora por WhatsApp'))
    expect(screen.getAllByTestId('msg-canal').map((e) => e.textContent)).toEqual(['Portal', 'WhatsApp'])
  })
  it('responde por donde escribió la última vez (WhatsApp) y se puede cambiar a Portal', async () => {
    const { enviados } = montar()
    await screen.findByTestId('responder-por')
    expect(screen.getByTestId('responder-por-whatsapp').getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByLabelText('Escribe tu mensaje'), { target: { value: 'Va por WhatsApp' } })
    fireEvent.click(screen.getByTestId('btn-enviar'))
    await waitFor(() => expect(enviados).toEqual([{ conv: 'WA', texto: 'Va por WhatsApp' }]))
    fireEvent.click(screen.getByTestId('responder-por-portal'))
    fireEvent.change(screen.getByLabelText('Escribe tu mensaje'), { target: { value: 'Y este por el portal' } })
    fireEvent.click(screen.getByTestId('btn-enviar'))
    await waitFor(() => expect(enviados[1]).toEqual({ conv: 'PORTAL', texto: 'Y este por el portal' }))
  })
})

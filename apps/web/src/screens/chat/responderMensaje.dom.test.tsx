// @vitest-environment jsdom
// RESPONDER A UN MENSAJE (19 nov 2026) · deslizar o «Responder», cita en el mensaje, y las piezas del servidor.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, textoCita, type Conversacion } from '../../data/ops/chat'
import { extraerWhatsApp } from '../../../../../supabase/functions/_shared/whatsapp'
import chatEdge from '../../../../../supabase/functions/chat/index.ts?raw'
import envio from '../../../../../supabase/functions/_shared/whatsappEnvio.ts?raw'
import webhook from '../../../../../supabase/functions/meta-webhook/index.ts?raw'
import mig from '../../../../../supabase/migrations/20270407240000_responder_mensaje.sql?raw'

afterEach(cleanup)
const ahora = new Date().toISOString()
const conv = (mensajes: Conversacion['mensajes']): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: mensajes.length, mensajes })

describe('Responder a un mensaje (pantalla)', () => {
  it('«Responder» lo cita arriba del cuadro y la respuesta sale ligada; la cita se ve en el mensaje', async () => {
    const llamadas: Array<Record<string, unknown>> = []
    const c = new ClienteChat(async (_f, { body }) => {
      llamadas.push(body)
      if (body.action === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null }
      if (body.action === 'leer') return { data: conv([
        { id: 'm1', seq: 1, actor: 'ai', content: 'Tenemos Golden Placenta en existencia.', created_at: ahora, propio: false },
        { id: 'm2', seq: 2, actor: 'doctor', content: 'Perfecto', created_at: ahora, propio: true, respuesta: { id: 'm1', texto: 'Tenemos Golden Placenta en existencia.', actor: 'ai' } }]), error: null }
      if (body.action === 'enviar') return { data: { id: 'm3', seq: 3, idempotente: false, modo: 'ai_active', ia: 'omitida' }, error: null }
      return { data: { ok: true }, error: null }
    }, () => null)
    render(<ChatCanonico cliente={c} conCarrito={false} intervaloMs={600_000} />)
    expect(await screen.findByTestId('msg-cita')).toHaveTextContent('Asistente')
    fireEvent.click(screen.getAllByTestId('btn-responder-msg')[0])
    expect(await screen.findByTestId('respondiendo')).toHaveTextContent('Tenemos Golden Placenta')
    fireEvent.change(screen.getByLabelText('Escribe tu mensaje'), { target: { value: 'Quiero 2' } })
    fireEvent.submit(screen.getByLabelText('Escribe tu mensaje').closest('form')!)
    await waitFor(() => expect(llamadas.find((b) => b.action === 'enviar')).toMatchObject({ content: 'Quiero 2', responde_a: 'm1' }))
    expect(screen.queryByTestId('respondiendo')).toBeNull()
  })
  it('las fotos y archivos citados se ven por lo que son', () => {
    expect(textoCita('Envió una imagen por WhatsApp.')).toBe('📷 Foto')
    expect(textoCita('Envió un audio por WhatsApp.')).toBe('🎤 Nota de voz')
    expect(textoCita('hola\n\nqué tal')).toBe('hola qué tal')
  })
})

describe('Responder a un mensaje (servidor y WhatsApp)', () => {
  it('cuando el cliente cita desde WhatsApp se lee el mensaje citado; la reacción no cuenta como cita', () => {
    const ev = (m: Record<string, unknown>) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ from: '5216671234567', id: 'wamid.NUEVO123', ...m }] } }] }] })
    expect(extraerWhatsApp(ev({ type: 'text', text: { body: 'Sí' }, context: { id: 'wamid.ORIGINAL1' } }))[0].citado).toBe('wamid.ORIGINAL1')
    expect(extraerWhatsApp(ev({ type: 'reaction', reaction: { emoji: '👍', message_id: 'wamid.X' }, context: { id: 'wamid.X' } }))[0].citado).toBeUndefined()
  })
  it('la Edge registra la respuesta ANTES de despachar; la salida de WhatsApp la manda citada; misma conversación', () => {
    expect(chatEdge.indexOf("_cc_respuesta_registrar")).toBeLessThan(chatEdge.indexOf('despacharWhatsApp(admin), despacharMeta(admin)]))   // WA-2'))
    expect(envio).toMatch(/context = \{ message_id: citado \}/)
    expect(webhook).toMatch(/_cc_respuesta_registrar', \{ p_message: r\.message_id, p_responde_a: origId \}/)
    expect(mig).toMatch(/is distinct from \(select conversation_id from public\.cc_messages where id = p_responde_a\)/)
  })
})

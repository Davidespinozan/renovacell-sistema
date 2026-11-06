// @vitest-environment jsdom
// BOT DETECTADO (6 nov 2026, dueño) · el personal ve arriba del redactor que el contacto parece un bot y que la IA ya no le contesta.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'

afterEach(cleanup)
const base: Conversacion = { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'supervisor', ultimo_seq: 0, mensajes: [] }
const canal = (bot: { motivo: string; at: string } | null) => ({ canal: 'whatsapp' as const, id: '5218007112222', modo: 'activo' as const, ventana_abierta: true, ventana_hasta: null, fallidos: 0, bot })
const montar = (c: Conversacion) => render(<ChatCanonico cliente={new ClienteChat(async (_f, { body }) => ({ data: body.action === 'leer' ? c : { ok: true }, error: null }), () => null)} asesor conversationId="C1" respuestas={null} conCarrito={false} intervaloMs={600_000} suscribir={null} />)

describe('aviso de bot en Conversaciones', () => {
  it('respuestas automáticas → «Parece un bot» y que la IA dejó de contestarle', async () => {
    montar({ ...base, canal: canal({ motivo: 'automatico', at: '2026-11-06T19:31:46Z' }) })
    const a = await screen.findByTestId('aviso-bot')
    expect(a.textContent).toMatch(/Parece un bot/)
    expect(a.textContent).toMatch(/respuestas automáticas/)
    expect(a.textContent).toMatch(/La IA dejó de contestarle/)
  })
  it('número 800 sin texto → lo explica así', async () => {
    montar({ ...base, canal: canal({ motivo: 'numero_empresa', at: '2026-11-06T19:31:46Z' }) })
    expect((await screen.findByTestId('aviso-bot')).textContent).toMatch(/número 800 de empresa/)
  })
  it('sin bot no hay aviso', async () => {
    montar({ ...base, canal: canal(null) })
    await screen.findByTestId('chat-modo')
    expect(screen.queryByTestId('aviso-bot')).toBeNull()
  })
})

// @vitest-environment jsdom
// CX-ENLACE · página del enlace de contacto: el MISMO chat con piel de mensajería, logo y accesos a la landing y a la
// verificación. CONTACTO CONVERSACIONAL: sin formulario (el asistente pide los datos en la conversación).
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Contacto, URL_LANDING } from './Contacto'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'

afterEach(cleanup)
const conv: Conversacion = { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: 2, mensajes: [
  { id: 'm1', seq: 1, actor: 'visitor', content: 'Hola', created_at: new Date().toISOString(), propio: true },
  { id: 'm2', seq: 2, actor: 'ai', content: 'Hola, ¿en qué te ayudo?', created_at: new Date().toISOString(), propio: false }] }
const cliente = () => new ClienteChat(async (_f, { body }) => body.action === 'abrir' ? { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null } : { data: body.action === 'leer' ? conv : { ok: true }, error: null }, () => null)
const base = { abrir: vi.fn(async () => 'reanudado' as const), conSesion: async () => 'ninguna' as const }

describe('Enlace de contacto', () => {
  // CONTACTO CONVERSACIONAL (dueño, 30 oct): sin formulario; se entra directo al chat y el asistente pide los datos platicando.
  it('sin formulario: entra directo al mismo chat (piel de mensajería, logo, palomitas), con quién habla arriba y el aviso de privacidad bajo el redactor', async () => {
    render(<Contacto {...base} cliente={cliente()} />)
    const chat = await screen.findByTestId('chat-canonico')
    expect(screen.queryByTestId('prerregistro')).toBeNull(); expect(screen.queryByLabelText('Nombre completo')).toBeNull()
    expect(chat.className).toMatch(/rc-chat--wa/); expect(chat.className).toMatch(/rc-chat--pagina/)
    expect(chat.querySelector('.rc-head .rc-mark img')).toBeTruthy()
    expect(chat.querySelector('.rc-thread [data-testid=contacto-confianza]')).toBeTruthy()
    expect(chat.querySelector('.rc-nota-redactor')!.textContent).toMatch(/Al escribirnos aceptas nuestro aviso de privacidad/)
    expect((chat.querySelector('.rc-nota-redactor a') as HTMLAnchorElement).getAttribute('href')).toBe('/landing/privacidad.html')
    expect(screen.getByTestId('ir-verificacion').textContent).toMatch(/Verificar mi cuenta/)
    expect((screen.getByTestId('ir-landing') as HTMLAnchorElement).getAttribute('href')).toBe(URL_LANDING)
    await screen.findByText('Hola, ¿en qué te ayudo?')
    expect(screen.getByTestId('msg-visitor').querySelector('.rc-tick')).toBeTruthy(); expect(screen.getByTestId('msg-ai').querySelector('.rc-tick')).toBeNull()
    expect(screen.queryByTestId('carrito-toggle')).toBeNull()
  })
  it('con sesión de doctor manda la cuenta: chat sin tarjeta de bienvenida ni aviso de visitante', async () => {
    const abrir = vi.fn(async () => 'reanudado' as const)
    render(<Contacto abrir={abrir} conSesion={async () => 'cliente'} cliente={cliente()} />)
    const chat = await screen.findByTestId('chat-canonico')
    expect(abrir).not.toHaveBeenCalled()
    expect(chat.querySelector('[data-testid=contacto-confianza]')).toBeNull(); expect(chat.querySelector('.rc-nota-redactor')).toBeNull()
    expect(screen.getByTestId('ir-portal')).toBeTruthy()
  })
  it('con sesión del personal: ni chat ni formulario; se le explica que es para clientes y puede copiar el enlace', async () => {
    render(<Contacto abrir={vi.fn(async () => 'reanudado' as const)} conSesion={async () => 'personal'} cliente={cliente()} />)
    const aviso = await screen.findByTestId('aviso-personal')
    expect(aviso.textContent).toMatch(/ventana de incógnito/); expect(screen.getByTestId('copiar-enlace-contacto')).toBeTruthy()
    expect(screen.queryByTestId('chat-canonico')).toBeNull()
  })
})

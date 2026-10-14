// @vitest-environment jsdom
// CX-ENLACE · página del enlace de contacto: sin prerregistro pide los datos; con prerregistro (o con sesión) abre
// el MISMO chat con piel de mensajería, logo y accesos a la landing y a la verificación.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { Contacto, URL_LANDING, URL_VERIFICACION } from './Contacto'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'

afterEach(cleanup)
const conv: Conversacion = { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: 2, mensajes: [
  { id: 'm1', seq: 1, actor: 'visitor', content: 'Hola', created_at: new Date().toISOString(), propio: true },
  { id: 'm2', seq: 2, actor: 'ai', content: 'Hola, ¿en qué te ayudo?', created_at: new Date().toISOString(), propio: false }] }
const cliente = () => new ClienteChat(async (_f, { body }) => body.action === 'abrir' ? { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null } : { data: body.action === 'leer' ? conv : { ok: true }, error: null }, () => null)
const base = { abrir: vi.fn(async () => 'reanudado' as const), conSesion: async () => 'ninguna' as const }
const llenar = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } })

describe('Enlace de contacto', () => {
  it('sin prerregistro: muestra el formulario con la marca, valida y no deja pasar sin aceptar el aviso', async () => {
    const registrar = vi.fn(async () => ({ ok: true as const, nombre: 'Ana Ruiz' }))
    render(<Contacto {...base} estado={async () => ({ visitante: true, prerregistrado: false, nombre: null })} registrar={registrar} cliente={cliente()} />)
    await screen.findByTestId('prerregistro')
    const antesala = screen.getByTestId('contacto-antesala')                       // ya se ve el chat: encabezado con logo, saludo en el hilo y redactor en espera
    expect(antesala.className).toMatch(/rc-chat--wa/); expect(antesala.querySelector('.rc-head .rc-mark img')).toBeTruthy()
    expect(antesala.querySelector('.rc-thread')!.textContent).toMatch(/Ya estamos aquí para atenderte/); expect(antesala.querySelector('.rc-thread [data-testid=prerregistro]')).toBeTruthy()
    expect(antesala.querySelector('.rc-composer')!.textContent).toMatch(/Completa tus datos para escribir/)
    expect(screen.queryByTestId('chat-canonico')).toBeNull()
    fireEvent.click(screen.getByTestId('iniciar-conversacion'))
    expect(screen.getByRole('alert').textContent).toMatch(/nombre completo/)
    llenar('Nombre completo', 'Ana Ruiz'); llenar('Celular', '669 000 0001'); llenar('Correo', 'ana@test.local')
    fireEvent.click(screen.getByTestId('iniciar-conversacion'))
    expect(screen.getByRole('alert').textContent).toMatch(/Aviso de privacidad/); expect(registrar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('acepta-aviso')); fireEvent.click(screen.getByTestId('iniciar-conversacion'))
    await screen.findByTestId('chat-canonico')
    expect(registrar).toHaveBeenCalledWith({ nombre: 'Ana Ruiz', telefono: '669 000 0001', email: 'ana@test.local', es_medico: false, cedula: '' })
  })
  it('la cédula solo se pide a quien dice ser profesional de la salud; un rechazo del servidor se muestra en su campo', async () => {
    const registrar = vi.fn(async () => ({ ok: false as const, mensaje: 'Escribe tu celular a 10 dígitos.', campo: 'telefono' as const }))
    render(<Contacto {...base} estado={async () => ({ visitante: false, prerregistrado: false, nombre: null })} registrar={registrar} cliente={cliente()} />)
    await screen.findByTestId('prerregistro')
    expect(screen.queryByLabelText(/Cédula profesional/)).toBeNull()
    fireEvent.click(screen.getByTestId('es-medico')); expect(screen.getByLabelText(/Cédula profesional/)).toBeTruthy()
    llenar('Nombre completo', 'Ana Ruiz'); llenar('Celular', '6690000001'); llenar('Correo', 'ana@test.local'); fireEvent.click(screen.getByTestId('acepta-aviso'))
    fireEvent.click(screen.getByTestId('iniciar-conversacion'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/10 dígitos/))
    expect(screen.queryByTestId('chat-canonico')).toBeNull()
  })
  it('con prerregistro: abre el mismo chat con piel de mensajería, logo, palomitas y accesos a la landing y a la verificación; sin carrito', async () => {
    render(<Contacto {...base} estado={async () => ({ visitante: true, prerregistrado: true, nombre: 'Ana Ruiz' })} cliente={cliente()} />)
    const chat = await screen.findByTestId('chat-canonico')
    expect(chat.className).toMatch(/rc-chat--wa/); expect(chat.className).toMatch(/rc-chat--pagina/)
    expect(chat.querySelector('.rc-head .rc-mark img')).toBeTruthy()
    expect((screen.getByTestId('ir-verificacion') as HTMLAnchorElement).getAttribute('href')).toBe(URL_VERIFICACION)
    expect((screen.getByTestId('ir-landing') as HTMLAnchorElement).getAttribute('href')).toBe(URL_LANDING)
    await screen.findByText('Hola, ¿en qué te ayudo?')
    expect(screen.getByTestId('msg-visitor').querySelector('.rc-tick')).toBeTruthy(); expect(screen.getByTestId('msg-ai').querySelector('.rc-tick')).toBeNull()
    expect(screen.queryByTestId('carrito-toggle')).toBeNull(); expect(screen.queryByTestId('prerregistro')).toBeNull()
  })
  it('con sesión de doctor manda la cuenta: no se pide prerregistro ni se consulta al visitante', async () => {
    const estado = vi.fn(async () => ({ visitante: false, prerregistrado: false, nombre: null }))
    render(<Contacto abrir={base.abrir} conSesion={async () => 'cliente'} estado={estado} cliente={cliente()} />)
    await screen.findByTestId('chat-canonico'); expect(estado).not.toHaveBeenCalled()
  })
  it('con sesión del personal: ni chat ni formulario; se le explica que es para clientes y puede copiar el enlace', async () => {
    const estado = vi.fn(async () => ({ visitante: false, prerregistrado: false, nombre: null }))
    render(<Contacto abrir={base.abrir} conSesion={async () => 'personal'} estado={estado} cliente={cliente()} />)
    const aviso = await screen.findByTestId('aviso-personal')
    expect(aviso.textContent).toMatch(/ventana de incógnito/); expect(screen.getByTestId('copiar-enlace-contacto')).toBeTruthy()
    expect(screen.queryByTestId('chat-canonico')).toBeNull(); expect(screen.queryByTestId('prerregistro')).toBeNull(); expect(estado).not.toHaveBeenCalled()
  })
})

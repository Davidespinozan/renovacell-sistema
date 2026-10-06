// @vitest-environment jsdom
// UX V2-B · La conversación como producto: encabezado por estado, chip de carrito, tarjeta de handoff,
// jerarquía de mensajes, redactor con Enter/Shift+Enter e idempotencia al reintentar.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico, subtituloDe } from './ChatCanonico'
import { ClienteChat, type Conversacion, type Mensaje } from '../../data/ops/chat'
import { ClienteCarrito, type Carrito } from '../../data/ops/carrito'

afterEach(cleanup)

const msg = (seq: number, actor: Mensaje['actor'], content: string, propio = false, at = '2026-10-06T22:00:00Z'): Mensaje => ({ id: 'm' + seq, seq, actor, content, created_at: at, propio })
const conv = (x: Partial<Conversacion> = {}): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: 0, mensajes: [], leido_hasta: 0, handoff: { origen: null, cart_id: null, fuera_horario: null, asignado: false, puede_rechazar: false }, ...x })

function chatFalso(c: Conversacion, fallarEnvio = 0) {
  const llamadas: Array<{ action: string; body: Record<string, unknown> }> = []
  let fallos = fallarEnvio
  const cliente = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string; llamadas.push({ action: a, body })
    if (a === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: c.modo, nuevo: false }, error: null }
    if (a === 'leer') { const desde = Number(body.desde_seq ?? 0); return { data: { ...c, mensajes: c.mensajes.filter((m) => m.seq > desde) }, error: null } }
    if (a === 'enviar') {
      if (fallos > 0) { fallos -= 1; return { data: null, error: { message: 'red' } } }
      const seq = c.mensajes.length + 1; c.mensajes = [...c.mensajes, msg(seq, 'doctor', body.content as string, true)]
      return { data: { id: 'n', seq, idempotente: false, modo: c.modo, ia: 'respondio' }, error: null }
    }
    return { data: { ok: true }, error: null }
  }, () => null)
  return { cliente, llamadas }
}
const cartVacio: Carrito = { cart_id: 'K', estado: 'active', rev: 1, dueno: 'profile', audiencia: 'verified', puede_precio: true, conversation_id: 'C1', items: [], n_items: 0, cantidad_total: 0, total: { estado: 'vacio' } }
const cartUno: Carrito = { ...cartVacio, n_items: 1, cantidad_total: 1, total: { estado: 'completo', monto: 350 }, items: [{ product_id: 'P', nombre: 'Golden Placenta Mask', presentacion: null, imagen_url: null, cantidad: 1, vendible: true, visible: true, disponibilidad: 'disponible', precio: { estado: 'autorizado', unitario: 350, subtotal: 350 } }] }
const carritoFalso = (cart: Carrito) => new ClienteCarrito(async () => ({ data: cart, error: null }), () => null)

describe('encabezado', () => {
  it('11 · IA activa: "Asistente Renovacell"; sin botón grande "Cerrar": controles de icono', async () => {
    const f = chatFalso(conv())
    render(<ChatCanonico panel embebido cliente={f.cliente} conCarrito={false} onSalir={() => {}} intervaloMs={60_000} />)
    expect(await screen.findByTestId('chat-modo')).toHaveTextContent('Asistente Renovacell')
    expect(screen.getByText('Renovacell')).toBeTruthy()
    const salir = screen.getByTestId('btn-salir')
    expect(salir.className).toContain('rc-ico'); expect(salir.className).not.toMatch(/\bbtn\b/); expect(salir.getAttribute('aria-label')).toBe('Cerrar')
    expect(screen.getByTestId('btn-minimizar')).toBeTruthy()
  })
  it('12 · asesor asignado, IA sigue: copia natural con el nombre, sin "Ventas"', () => {
    expect(subtituloDe(conv({ modo: 'human_assigned', asesor_nombre: 'Lucía', handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: null, asignado: true, puede_rechazar: true } }), false)).toBe('Lucía se unirá pronto · el asistente sigue contigo')
    expect(subtituloDe(conv({ modo: 'human_requested', handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: true, asignado: false, puede_rechazar: true } }), false)).toMatch(/horario de atención · el asistente sigue contigo/)
  })
  it('13 · humano activo: "Lucía · Asesora"', () => {
    expect(subtituloDe(conv({ modo: 'human_active', asesor_nombre: 'Lucía' }), false)).toBe('Lucía · Asesora')
    expect(subtituloDe(conv({ modo: 'human_active', asesor_nombre: 'Lucía' }), false)).not.toMatch(/Ventas/)
  })
})

describe('carrito', () => {
  it('14 · vacío: ninguna franja persistente', async () => {
    const f = chatFalso(conv())
    render(<ChatCanonico panel embebido cliente={f.cliente} clienteCarrito={carritoFalso(cartVacio)} intervaloMs={60_000} />)
    await screen.findByTestId('chat-modo')
    await waitFor(() => expect(f.llamadas.some((l) => l.action === 'leer')).toBe(true))
    expect(screen.queryByTestId('carrito-panel')).toBeNull()
  })
  it('15/16 · con producto: chip "1 producto · $350" que expande el carrito canónico', async () => {
    const f = chatFalso(conv())
    render(<ChatCanonico panel embebido cliente={f.cliente} clienteCarrito={carritoFalso(cartUno)} intervaloMs={60_000} />)
    const chip = await screen.findByTestId('carrito-toggle')
    expect(chip.className).toContain('rc-chip'); expect(chip).toHaveTextContent('1 producto'); expect(chip).toHaveTextContent('$350')
    expect(screen.queryByTestId('carrito-item')).toBeNull()
    fireEvent.click(chip)
    expect(await screen.findByTestId('carrito-item')).toHaveTextContent('Golden Placenta Mask')
    expect(screen.getByTestId('carrito-revisar')).toHaveTextContent('Revisar y confirmar pedido')
  })
})

describe('hilo', () => {
  it('17/18 · tarjeta de handoff en lugar del aviso del sistema; propio/IA/asesor/sistema con clases distintas', async () => {
    const c = conv({ modo: 'human_assigned', asesor_nombre: 'Lucía', ultimo_seq: 4, handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: null, asignado: true, puede_rechazar: true },
      mensajes: [msg(1, 'doctor', 'Hola', true), msg(2, 'ai', 'Hola doctor'), msg(3, 'seller', 'Soy Lucía'), msg(4, 'system', 'Registramos tu solicitud…')] })
    const f = chatFalso(c)
    render(<ChatCanonico panel embebido cliente={f.cliente} conCarrito={false} intervaloMs={60_000} />)
    const card = await screen.findByTestId('aviso-handoff')
    expect(card.className).toContain('rc-card')
    expect(card).toHaveTextContent('Lucía se unirá a esta conversación.')   // asignada; horario sin configurar ⇒ sin promesa de tiempo
    expect(screen.getByTestId('btn-rechazar-asesor')).toHaveTextContent('Seguir solo con el asistente')
    expect(screen.queryByTestId('msg-system')).toBeNull()                       // sin duplicar: la tarjeta ocupa su lugar
    expect(screen.getByTestId('msg-doctor').className).toContain('rc-msg--own')
    expect(screen.getByTestId('msg-ai').className).toContain('rc-msg--ai')
    const seller = screen.getByTestId('msg-seller'); expect(seller.className).toContain('rc-msg--seller'); expect(seller).toHaveTextContent('Lucía · Asesora')
    expect(screen.getAllByText('Hoy').length).toBeGreaterThan(0)              // separador de día
  })
})

describe('redactor', () => {
  it('Enter envía, Shift+Enter no; "escribiendo" mientras responde la IA; reintento con el MISMO client_message_id', async () => {
    const f = chatFalso(conv(), 1)
    render(<ChatCanonico panel embebido cliente={f.cliente} conCarrito={false} intervaloMs={60_000} />)
    const area = await screen.findByLabelText('Escribe tu mensaje') as HTMLTextAreaElement
    expect(area.tagName).toBe('TEXTAREA'); expect(area.getAttribute('enterkeyhint')).toBe('send')
    fireEvent.change(area, { target: { value: 'hola' } })
    fireEvent.keyDown(area, { key: 'Enter', shiftKey: true })
    expect(f.llamadas.filter((l) => l.action === 'enviar').length).toBe(0)
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(await screen.findByTestId('btn-reintentar')).toBeTruthy()           // primer intento falla (red)
    const primero = f.llamadas.filter((l) => l.action === 'enviar')[0].body.client_message_id
    fireEvent.click(screen.getByTestId('btn-reintentar'))
    await waitFor(() => expect(f.llamadas.filter((l) => l.action === 'enviar').length).toBe(2))
    expect(f.llamadas.filter((l) => l.action === 'enviar')[1].body.client_message_id).toBe(primero)
    await waitFor(() => expect(screen.queryByTestId('msg-pendiente')).toBeNull())
    expect(screen.getByTestId('msg-doctor')).toHaveTextContent('hola')
  })
})

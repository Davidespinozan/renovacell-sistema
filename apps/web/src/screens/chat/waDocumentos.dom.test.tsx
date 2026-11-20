// @vitest-environment jsdom
// DOCUMENTOS DE WHATSAPP (20 nov 2026) · en Conversaciones el documento del cliente se ve como tarjeta con su nombre y se
// abre; lo que escribió junto al archivo se lee; si el archivo aún no llega se relee solo, y si ya no llegó se dice.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, type Conversacion, type Mensaje } from '../../data/ops/chat'

afterEach(cleanup)
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const conv = (mensajes: Mensaje[]): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'human_active', rol: 'asesor', ultimo_seq: mensajes.reduce((s, m) => Math.max(s, m.seq), 0), mensajes })
const PDF = { id: 'f1', url: 'https://firmada/comprobante.pdf', tipo: 'application/pdf', clase: 'documento' as const, bytes: 204_800, nombre: 'Comprobante SPEI.pdf' }
const doc = (extra: Partial<Mensaje> = {}): Mensaje => ({ id: 'm1', seq: 1, actor: 'visitor', content: 'Envió un documento por WhatsApp.', created_at: hace(30), propio: false, ...extra })
const montar = (leer: (desde: number) => Conversacion, props: Record<string, unknown> = { asesor: true, conversationId: 'C1' }) => {
  const lecturas: number[] = []
  const c = new ClienteChat(async (_f, { body }) => {
    if (body.action === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: 'human_active', nuevo: false }, error: null }
    if (body.action === 'leer') { lecturas.push(Number(body.desde_seq ?? 0)); return { data: leer(Number(body.desde_seq ?? 0)), error: null } }
    return { data: { ok: true }, error: null }
  }, () => null)
  render(<ChatCanonico cliente={c} respuestas={null} conCarrito={false} intervaloMs={600_000} esperaArchivoMs={25} hiloDePersona={async () => null} suscribir={() => () => {}} {...props} />)
  return lecturas
}

describe('Documento del cliente por WhatsApp (pantalla del vendedor)', () => {
  it('se ve la tarjeta con nombre, tipo y peso, y abre el archivo; lo que escribió junto al documento también se lee', async () => {
    montar(() => conv([doc({ content: 'Envió un documento por WhatsApp. «mi comprobante de hoy»', archivo: PDF })]))
    const t = await screen.findByTestId('msg-documento')
    expect(t).toHaveTextContent('Comprobante SPEI.pdf'); expect(t).toHaveTextContent('PDF · 200 KB')
    expect((t.querySelector('a') as HTMLAnchorElement).href).toBe('https://firmada/comprobante.pdf')
    expect(screen.getByTestId('msg-pie')).toHaveTextContent('mi comprobante de hoy')
    expect(screen.queryByTestId('msg-archivo-nota')).toBeNull()
  })
  it('un documento viejo que nunca se guardó lo dice claro (solo al equipo)', async () => {
    montar(() => conv([doc()]))
    expect(await screen.findByTestId('msg-archivo-nota')).toHaveTextContent('Este archivo no quedó guardado. Pídele que lo mande otra vez.')
    expect(screen.queryByTestId('msg-documento')).toBeNull()
    cleanup()
    montar(() => ({ ...conv([doc({ actor: 'doctor', propio: true })]), rol: 'dueno' }), {})
    await screen.findByText('Envió un documento por WhatsApp.')
    expect(screen.queryByTestId('msg-archivo-nota')).toBeNull()
  })
  it('el archivo llega unos segundos después que el mensaje: se relee solo y aparece sin cerrar la conversación', async () => {
    let n = 0
    const lecturas = montar(() => { n += 1; return conv([doc({ created_at: hace(0), ...(n >= 3 ? { archivo: PDF } : {}) })]) })
    expect(await screen.findByTestId('msg-archivo-nota')).toHaveTextContent('Recibiendo el archivo…')
    const t = await screen.findByTestId('msg-documento')
    expect(t).toHaveTextContent('Comprobante SPEI.pdf')
    expect(screen.queryByTestId('msg-archivo-nota')).toBeNull()
    expect(lecturas.slice(1).every((d) => d === 0)).toBe(true)   // relee DESDE antes de ese mensaje (seq 1 → desde 0)
    const hasta = lecturas.length
    await new Promise((r) => setTimeout(r, 120))
    expect(lecturas.length).toBe(hasta)   // con el archivo en pantalla deja de releer
  })
  it('una foto de WhatsApp con texto muestra la foto y su texto', async () => {
    montar(() => conv([doc({ content: 'Envió una imagen por WhatsApp. «quiero 3 de estas»', adjunto: { id: 'a1', url: 'https://firmada/foto.jpg', tipo: 'image/jpeg', uso: null } })]))
    await waitFor(() => expect(screen.getByTestId('msg-imagen')).toBeInTheDocument())
    expect(screen.getByTestId('msg-pie')).toHaveTextContent('quiero 3 de estas')
  })
})

// @vitest-environment jsdom
// MENÚ «+» DEL CHAT (3 nov 2026) · las acciones con el cliente se cierran con el ✕, tocando fuera o con Esc; antes solo
// volviendo a tocar el «+» y el menú parecía no poder cerrarse.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'

afterEach(cleanup)
const conv: Conversacion = { conversation_id: 'C1', estado: 'abierta', modo: 'human_active', rol: 'asesor', ultimo_seq: 0, mensajes: [] }
const montar = (onElegir = vi.fn()) => {
  const c = new ClienteChat(async (_f, { body }) => ({ data: body.action === 'leer' ? conv : { ok: true }, error: null }), () => null)
  render(<ChatCanonico cliente={c} asesor conversationId="C1" conCarrito={false} intervaloMs={600_000}
    acciones={[{ clave: 'cotizar', etiqueta: 'Cotizar', onElegir }, { clave: 'ficha', etiqueta: 'Ver su ficha', onElegir: vi.fn() }]} />)
  return onElegir
}
const abrir = async () => { fireEvent.click(await screen.findByTestId('btn-acciones')); return screen.getByTestId('menu-acciones') }

describe('menú de acciones del chat', () => {
  it('se cierra con el ✕', async () => {
    montar(); await abrir()
    fireEvent.click(screen.getByTestId('acciones-cerrar'))
    expect(screen.queryByTestId('menu-acciones')).toBeNull()
  })
  it('se cierra tocando fuera y con Esc; tocar dentro no lo cierra', async () => {
    montar(); const m = await abrir()
    fireEvent.pointerDown(m)
    expect(screen.getByTestId('menu-acciones')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByTestId('menu-acciones')).toBeNull())
    await abrir()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('menu-acciones')).toBeNull())
  })
  it('el «+» lo abre y lo cierra, y elegir una acción la ejecuta y cierra el menú', async () => {
    const onElegir = montar(); await abrir()
    fireEvent.pointerDown(screen.getByTestId('btn-acciones')); fireEvent.click(screen.getByTestId('btn-acciones'))
    expect(screen.queryByTestId('menu-acciones')).toBeNull()
    await abrir()
    fireEvent.click(screen.getByTestId('accion-cotizar'))
    expect(onElegir).toHaveBeenCalled(); expect(screen.queryByTestId('menu-acciones')).toBeNull()
  })
})

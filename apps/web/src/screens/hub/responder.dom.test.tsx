// @vitest-environment jsdom
// RESPONDER A UN MENSAJE EN EL CHAT DEL EQUIPO (19 nov 2026)
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Chat } from './Chat'
import mig from '../../../../../supabase/migrations/20270407250000_equipo_responder.sql?raw'

beforeEach(cleanup)
describe('Chat del equipo · responder a un mensaje', () => {
  it('«Responder» cita el mensaje arriba del cuadro y la respuesta lo muestra; tocar la cita lleva al original', async () => {
    Element.prototype.scrollIntoView = () => {}
    renderWithRole(<Chat />)
    fireEvent.click(screen.getByText('Todos'))
    const caja = screen.getByPlaceholderText(/Mensaje a Todos/i)
    fireEvent.change(caja, { target: { value: '¿Quién surte el pedido de mañana?' } })
    fireEvent.keyDown(caja, { key: 'Enter' })
    await screen.findAllByText('¿Quién surte el pedido de mañana?')
    const botones = screen.getAllByTestId('tc-responder')
    fireEvent.click(botones[botones.length - 1])
    expect(await screen.findByTestId('tc-respondiendo')).toHaveTextContent('¿Quién surte el pedido de mañana?')
    fireEvent.change(caja, { target: { value: 'Yo lo surto' } })
    fireEvent.keyDown(caja, { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByTestId('tc-cita').at(-1)).toHaveTextContent('Tú¿Quién surte el pedido de mañana?'))
    expect(screen.queryByTestId('tc-respondiendo')).toBeNull()
    fireEvent.click(screen.getAllByTestId('tc-cita').at(-1)!)
  })
  it('la base solo acepta citar un mensaje de la misma conversación', () => {
    expect(mig).toMatch(/m\.id = new\.responde_a and m\.conversation_id = new\.conversation_id/)
    expect(mig).toMatch(/on delete set null/)
  })
})

// @vitest-environment jsdom
// Test del Chat interno (modo mock): lista de conversaciones + abrir un hilo +
// directorio de staff en "Nuevo".
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, cleanup, within } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Chat } from './Chat'

beforeEach(cleanup)

describe('<Chat>', () => {
  it('muestra la lista de conversaciones (grupos + DM)', () => {
    renderWithRole(<Chat />)
    expect(screen.getByText('Conversaciones')).toBeInTheDocument()
    expect(screen.getByText('Todos')).toBeInTheDocument()
    expect(screen.getByText('Almacén y Empaque')).toBeInTheDocument()
    expect(screen.getByText('Dirección')).toBeInTheDocument()
  })

  it('abre un hilo al hacer clic y muestra su composer', () => {
    renderWithRole(<Chat />)
    fireEvent.click(screen.getByText('Almacén y Empaque'))
    expect(screen.getByPlaceholderText(/Mensaje a Almacén y Empaque/i)).toBeInTheDocument()
    // Mensaje sembrado del hilo de almacén.
    expect(screen.getByText(/STL-44/)).toBeInTheDocument()
  })

  it('el botón "Nuevo" abre el directorio de staff', () => {
    renderWithRole(<Chat />)
    fireEvent.click(screen.getByText('Nuevo'))
    expect(screen.getByText('Nuevo mensaje')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Buscar persona/i)).toBeInTheDocument()
  })

  it('envía un mensaje en un hilo abierto', () => {
    renderWithRole(<Chat />)
    fireEvent.click(screen.getByText('Todos'))
    const input = screen.getByPlaceholderText(/Mensaje a Todos/i)
    fireEvent.change(input, { target: { value: 'Mensaje de prueba' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('Mensaje de prueba')).toBeInTheDocument()
  })

  it('vuelve a la lista con la flecha y abre otro hilo', () => {
    renderWithRole(<Chat />)
    fireEvent.click(screen.getByText('Todos'))
    expect(screen.getByPlaceholderText(/Mensaje a Todos/i)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Volver a conversaciones'))
    // De vuelta en la lista.
    expect(screen.getByText('Conversaciones')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Dirección'))
    expect(screen.getByPlaceholderText(/Mensaje a Dirección/i)).toBeInTheDocument()
  })

  it('abre un DM desde el directorio de staff', () => {
    renderWithRole(<Chat />)
    fireEvent.click(screen.getByText('Nuevo'))
    fireEvent.click(screen.getByText('Alberto Almacén'))
    // Se abre el hilo del DM con su composer.
    expect(screen.getByPlaceholderText(/Mensaje a Alberto Almacén/i)).toBeInTheDocument()
  })
})

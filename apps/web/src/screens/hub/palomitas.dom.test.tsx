// @vitest-environment jsdom
// EQUIPO-LECTURAS (3 nov 2026) · palomitas azules y "escribiendo…" en el Chat del equipo, igual que en Conversaciones.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Chat } from './Chat'
import { textoEscribiendo, vistoPor, type ClienteLecturas, type Lector } from '../../data/ops/lecturasEquipo'

beforeEach(cleanup)
const L = (x: Partial<Lector>): Lector => ({ profile_id: 'P', nombre: 'Ana López', leido_hasta: null, escribiendo: false, ...x })
const cliente = (lectores: Lector[]) => {
  const c: ClienteLecturas = { lectores: vi.fn(async () => lectores), leido: vi.fn(async () => {}), escribiendo: vi.fn(async () => {}), suscribir: vi.fn(() => () => {}) }
  return c
}

describe('palomitas y escribiendo (reglas)', () => {
  it('visto por instante, no por texto; en grupo, todos', () => {
    const t = '2026-11-03T17:00:00.000Z'
    expect(vistoPor([L({ leido_hasta: '2026-11-03T17:00:00+00:00' })], t).visto).toBe(true)
    expect(vistoPor([L({ leido_hasta: '2026-11-03T16:59:59+00:00' })], t).visto).toBe(false)
    expect(vistoPor([L({ leido_hasta: t }), L({ profile_id: 'Q', leido_hasta: null })], t)).toEqual({ visto: false, n: 1, de: 2 })
    expect(vistoPor([], t).visto).toBe(false)
  })
  it('texto de escribiendo', () => {
    expect(textoEscribiendo([L({ escribiendo: true })], false)).toBe('escribiendo…')
    expect(textoEscribiendo([L({ escribiendo: true }), L({ nombre: 'Beto Ruiz', escribiendo: true })], true)).toBe('Ana y Beto están escribiendo…')
    expect(textoEscribiendo([L({})], true)).toBeNull()
  })
})

describe('<Chat> del equipo', () => {
  it('mi mensaje sale en azul cuando lo vieron todos y el encabezado dice quién escribe', async () => {
    const c = cliente([L({ leido_hasta: '2999-01-01T00:00:00Z', escribiendo: true })])
    renderWithRole(<Chat lecturas={c} />)
    fireEvent.click(screen.getByText('Todos'))
    fireEvent.change(screen.getByPlaceholderText(/Mensaje a Todos/i), { target: { value: 'Ya llegó el pedido' } })
    fireEvent.click(screen.getByLabelText('Enviar'))
    const hilo = document.querySelector('.rc-thread') as HTMLElement
    await waitFor(() => expect(within(hilo).getAllByTestId('tc-visto').length).toBeGreaterThan(0))
    expect(screen.getByTestId('tc-estado')).toHaveTextContent('Ana está escribiendo…')
    expect(c.suscribir).toHaveBeenCalled(); expect(c.leido).toHaveBeenCalled()
  })
  it('sin leer: gris; al teclear avisa que escribo y al mandar lo quita', async () => {
    const c = cliente([L({ leido_hasta: null })])
    renderWithRole(<Chat lecturas={c} />)
    fireEvent.click(screen.getByText('Todos'))
    const input = screen.getByPlaceholderText(/Mensaje a Todos/i)
    fireEvent.change(input, { target: { value: 'Hola' } })
    await waitFor(() => expect(c.escribiendo).toHaveBeenCalledWith(expect.any(String), true))
    fireEvent.click(screen.getByLabelText('Enviar'))
    expect(c.escribiendo).toHaveBeenLastCalledWith(expect.any(String), false)
    const hilo = document.querySelector('.rc-thread') as HTMLElement
    await waitFor(() => expect(within(hilo).getAllByTestId('tc-entregado').length).toBeGreaterThan(0))
  })
})

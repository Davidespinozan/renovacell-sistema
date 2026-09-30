// @vitest-environment jsdom
// Tests de las pantallas de Punto de Venta / Eventos (modo mock).
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Eventos } from './Eventos'

beforeEach(cleanup)

describe('<Eventos>', () => {
  it('muestra el módulo de eventos y explica que el stand es producto en custodia', () => {
    renderWithRole(<Eventos />)
    expect(screen.getByRole('heading', { name: 'Eventos' })).toBeInTheDocument()
    expect(screen.getByText(/producto de la empresa en custodia/i)).toBeInTheDocument()
  })
  it('no promete vender ni entregar desde aquí: cada quien hace lo suyo', () => {
    renderWithRole(<Eventos />)
    // Almacén entrega, Punto de venta cobra, Dirección cierra (authority matrix de W2-C).
    expect(screen.getByText(/Almacén lo entrega y lo recibe/i)).toBeInTheDocument()
  })
})

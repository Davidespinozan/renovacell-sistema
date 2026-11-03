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
    expect(screen.getByText(/El equipo del evento\s+vende en Punto de venta/i)).toBeInTheDocument()
  })
  it('cada quien hace lo suyo: Alberto crea y entrega, el equipo vende, Almacén o Dirección cierran', () => {
    renderWithRole(<Eventos />)
    // EVENTOS CON EQUIPO (2 nov 2026): solo Almacén crea el evento y elige al equipo.
    expect(screen.getByText(/Alberto \(Almacén\) crea el evento, elige quién va/i)).toBeInTheDocument()
  })
  it('Dirección ve los eventos pero no los crea', () => {
    renderWithRole(<Eventos />)   // el RoleProvider de prueba entra como Dirección
    expect(screen.queryByTestId('evento-nuevo')).toBeNull()
  })
})

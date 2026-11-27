// @vitest-environment jsdom
// Tests de pantallas de Administración/Dirección (modo mock).
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Doctores } from './Doctores'
import { Finanzas } from './Finanzas'
import { Trazabilidad } from './Trazabilidad'

beforeEach(cleanup)

describe('<Doctores>', () => {
  it('lista a los doctores (verificación de acceso)', () => {
    renderWithRole(<Doctores />)
    expect(screen.getByText('Administración · Por verificar')).toBeInTheDocument()
    expect(screen.getByText(/Laura Méndez/)).toBeInTheDocument()
  })
})

describe('<Finanzas>', () => {
  it('muestra el estado de resultados', () => {
    renderWithRole(<Finanzas />)
    expect(screen.getByText('Finanzas')).toBeInTheDocument()
    expect(screen.getByText(/Estado de resultados/)).toBeInTheDocument()
  })
})

describe('<Trazabilidad>', () => {
  it('muestra el módulo de trazabilidad (recall COFEPRIS)', () => {
    renderWithRole(<Trazabilidad />)
    expect(screen.getByTestId('quees-trazabilidad')).toHaveTextContent('Trazabilidad.')   // la pantalla se explica sola (27 nov)
    expect(screen.getByRole('button', { name: /Seguir un lote/ })).toBeInTheDocument()
  })
  it('cambia a "Revisar un pedido"', () => {
    renderWithRole(<Trazabilidad />)
    fireEvent.click(screen.getByRole('button', { name: /Revisar un pedido/ }))
    // Al cambiar de modo, aparece el selector de pedido.
    expect(screen.getByText('Pedido')).toBeInTheDocument()
  })
})

// @vitest-environment jsdom
// Tests de las pantallas de Punto de Venta / Eventos (modo mock).
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Eventos } from './Eventos'

beforeEach(cleanup)

describe('<Eventos>', () => {
  it('muestra el módulo de ventas por evento', () => {
    renderWithRole(<Eventos />)
    expect(screen.getByText('Ventas · Eventos')).toBeInTheDocument()
  })
})

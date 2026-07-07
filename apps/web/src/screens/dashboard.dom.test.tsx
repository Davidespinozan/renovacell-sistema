// @vitest-environment jsdom
// Tablero y Ventas usan recharts → dependen de los shims de ResizeObserver/matchMedia.
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { Tablero } from './admin/Tablero'
import { Ventas } from './admin/Ventas'
import { Asistente } from './doctor/Asistente'
import { CommonView } from './CommonView'
import { MisEntregas } from './driver/MisEntregas'

beforeEach(cleanup)

describe('<Tablero>', () => {
  it('renderiza el tablero de Dirección', () => {
    renderWithRole(<Tablero />)
    expect(screen.getByText('Administración · Tablero')).toBeInTheDocument()
  })
})

describe('<Ventas>', () => {
  it('renderiza el panel de ventas', () => {
    renderWithRole(<Ventas />)
    expect(screen.getByText('Administración · Ventas')).toBeInTheDocument()
  })
})

describe('<Asistente>', () => {
  it('renderiza el asistente del doctor', () => {
    renderWithRole(<Asistente />)
    expect(screen.getByText('Portal del Doctor · Asistente')).toBeInTheDocument()
  })
})

describe('<CommonView>', () => {
  it('renderiza la vista común con la biblioteca', () => {
    renderWithRole(<CommonView />)
    expect(screen.getByText('Biblioteca')).toBeInTheDocument()
  })
})

describe('<MisEntregas>', () => {
  it('renderiza la ruta del chofer', () => {
    renderWithRole(<MisEntregas />)
    expect(screen.getByText(/Mi ruta/)).toBeInTheDocument()
  })
})

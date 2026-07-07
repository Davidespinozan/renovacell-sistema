// @vitest-environment jsdom
// Tests de las pantallas de Almacén (modo mock).
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Existencias } from './Existencias'
import { Surtido } from './Surtido'
import { Entradas } from './Entradas'
import { Caducidades } from './Caducidades'

beforeEach(cleanup)

describe('<Existencias>', () => {
  it('muestra el inventario del almacén', () => {
    renderWithRole(<Existencias />)
    expect(screen.getByText('Lo que hay en almacén')).toBeInTheDocument()
  })
})

describe('<Surtido>', () => {
  it('muestra la cola de preparación de pedidos', () => {
    renderWithRole(<Surtido />)
    expect(screen.getByText('Preparar pedidos')).toBeInTheDocument()
  })
})

describe('<Entradas>', () => {
  it('muestra el formulario de registro de entradas', () => {
    renderWithRole(<Entradas />)
    expect(screen.getByText('Registrar entradas')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ej. MGP-90-C')).toBeInTheDocument()
  })
  it('permite escribir un lote nuevo', () => {
    renderWithRole(<Entradas />)
    const input = screen.getByPlaceholderText('Ej. MGP-90-C') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'LOTE-TEST-01' } })
    expect(input.value).toBe('LOTE-TEST-01')
  })
})

describe('<Caducidades>', () => {
  it('muestra los lotes por caducar', () => {
    renderWithRole(<Caducidades />)
    expect(screen.getByText('Por caducar')).toBeInTheDocument()
  })
})

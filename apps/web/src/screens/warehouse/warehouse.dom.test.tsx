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

  it('permite seleccionar varios pedidos surtibles y muestra la barra de lote', () => {
    renderWithRole(<Surtido />)
    const checks = screen.queryAllByRole('checkbox')
    expect(checks.length).toBeGreaterThan(0) // el mock tiene pedidos pagados con stock
    fireEvent.click(checks[0])
    // al seleccionar aparece la acción de surtido en lote (no se confirma → no muta)
    expect(screen.getByRole('button', { name: /Surtir seleccionados/ })).toBeInTheDocument()
  })
})

describe('<Entradas>', () => {
  it('UX-2 · "Recibir mercancía": compras pendientes primero; la entrada excepcional va aparte y cerrada', () => {
    renderWithRole(<Entradas />)
    expect(screen.getByText('Recibir mercancía')).toBeInTheDocument()
    expect(screen.getByText(/Compras pendientes de recibir/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Ej. MGP-90-C')).toBeNull()
    fireEvent.click(screen.getByTestId('btn-excepcional'))
    expect(screen.getByPlaceholderText('Ej. MGP-90-C')).toBeInTheDocument()
  })
  it('permite escribir un lote nuevo en la entrada excepcional', () => {
    renderWithRole(<Entradas />)
    fireEvent.click(screen.getByTestId('btn-excepcional'))
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

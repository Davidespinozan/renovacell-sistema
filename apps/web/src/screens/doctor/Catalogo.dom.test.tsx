// @vitest-environment jsdom
// Test de componente del Catálogo del Portal del Doctor (modo mock).
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Catalogo } from './Catalogo'

beforeEach(cleanup)

describe('<Catalogo>', () => {
  it('muestra el catálogo con sus filtros y productos', () => {
    render(<Catalogo />)
    expect(screen.getByText('Portal del Doctor · Catálogo')).toBeInTheDocument()
    // Las pestañas de filtro son botones (evita chocar con los badges de producto).
    expect(screen.getByRole('button', { name: 'Todos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Home Care' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Professional' })).toBeInTheDocument()
    expect(screen.getByText('Golden Serum')).toBeInTheDocument()
  })

  it('el carrito arranca vacío', () => {
    render(<Catalogo />)
    expect(screen.getByText(/Agrega productos del catálogo/)).toBeInTheDocument()
  })

  it('filtra a Professional (cambia los productos mostrados)', () => {
    render(<Catalogo />)
    fireEvent.click(screen.getByRole('button', { name: 'Professional' }))
    // Golden Serum es Home Care → deja de mostrarse al filtrar Professional.
    expect(screen.queryByText('Golden Serum')).toBeNull()
  })

  it('agregar un producto lo mete al pedido (carrito deja de estar vacío)', () => {
    render(<Catalogo />)
    const addButtons = screen.getAllByText('Agregar')
    expect(addButtons.length).toBeGreaterThan(0) // hay productos con existencia
    fireEvent.click(addButtons[0])
    expect(screen.queryByText(/Agrega productos del catálogo/)).toBeNull()
    expect(screen.getByText('Vaciar')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('vaciar el carrito lo regresa al estado vacío', () => {
    render(<Catalogo />)
    fireEvent.click(screen.getAllByText('Agregar')[0])
    expect(screen.getByText('Vaciar')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Vaciar'))
    expect(screen.getByText(/Agrega productos del catálogo/)).toBeInTheDocument()
  })

  it('el filtro Home Care conserva Golden Serum (es cosmética)', () => {
    render(<Catalogo />)
    fireEvent.click(screen.getByRole('button', { name: 'Home Care' }))
    expect(screen.getByText('Golden Serum')).toBeInTheDocument()
  })

  it('volver a "Todos" tras filtrar vuelve a mostrar todo', () => {
    render(<Catalogo />)
    fireEvent.click(screen.getByRole('button', { name: 'Professional' }))
    expect(screen.queryByText('Golden Serum')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.getByText('Golden Serum')).toBeInTheDocument()
  })
})

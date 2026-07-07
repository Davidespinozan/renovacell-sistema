// @vitest-environment jsdom
// Test de componente del Calendario de Diseño (modo mock: semillas del store).
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { Calendario } from './Calendario'

beforeEach(cleanup)

describe('<Calendario>', () => {
  it('renderiza el encabezado y los compromisos sembrados', () => {
    render(<Calendario />)
    expect(screen.getByText('Diseño · Calendario de entregas y producción')).toBeInTheDocument()
    // El store mock trae 3 compromisos; aparecen en "Próximos compromisos".
    expect(screen.getAllByText(/Golden Serum/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/congreso CDMX/).length).toBeGreaterThan(0)
  })

  it('abre el modal de "Nuevo compromiso" y muestra los tipos', () => {
    render(<Calendario />)
    fireEvent.click(screen.getByText('Nuevo compromiso'))
    const dialog = screen.getByText('Agendar').closest('.modal') as HTMLElement
    expect(dialog).toBeTruthy()
    expect(within(dialog).getByText('Entrega')).toBeInTheDocument()
    expect(within(dialog).getByText('Producción')).toBeInTheDocument()
    expect(within(dialog).getByText('Campaña')).toBeInTheDocument()
  })

  it('agenda un compromiso nuevo y aparece en la lista', () => {
    render(<Calendario />)
    fireEvent.click(screen.getByText('Nuevo compromiso'))
    const input = screen.getByPlaceholderText(/Entrega fichas/i)
    fireEvent.change(input, { target: { value: 'Entrega catálogo impreso' } })
    fireEvent.click(screen.getByText('Agendar'))
    expect(screen.getAllByText('Entrega catálogo impreso').length).toBeGreaterThan(0)
  })

  it('el botón Agendar está deshabilitado sin título', () => {
    render(<Calendario />)
    fireEvent.click(screen.getByText('Nuevo compromiso'))
    expect(screen.getByText('Agendar').closest('button')).toBeDisabled()
  })

  it('marca un compromiso como listo y ofrece reabrir', () => {
    render(<Calendario />)
    const listoBtns = screen.getAllByText('Listo')
    expect(listoBtns.length).toBeGreaterThan(0)
    fireEvent.click(listoBtns[0])
    // Al marcarse listo, ese renglón ofrece "Reabrir".
    expect(screen.getAllByText('Reabrir').length).toBeGreaterThan(0)
  })

  it('muestra la leyenda de tipos (Entrega/Producción/Campaña)', () => {
    render(<Calendario />)
    // La leyenda del calendario lista los 3 tipos.
    expect(screen.getAllByText('Entrega').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Producción').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Campaña').length).toBeGreaterThan(0)
  })

  it('cerrar el modal sin agendar no agrega nada', () => {
    render(<Calendario />)
    fireEvent.click(screen.getByText('Nuevo compromiso'))
    fireEvent.click(screen.getByText('Cancelar'))
    expect(screen.queryByText('Agendar')).toBeNull()
  })
})

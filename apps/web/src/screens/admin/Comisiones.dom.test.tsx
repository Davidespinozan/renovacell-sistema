// @vitest-environment jsdom
// Prueba de humo del panel de Metas y comisiones (modo mock: roster de vendedores +
// metas sembradas). Verifica que renderiza, muestra la tasa y calcula por vendedor.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Comisiones } from './Comisiones'

beforeEach(cleanup)

describe('<Comisiones>', () => {
  it('renderiza el encabezado, las tasas por línea y la tabla por vendedor', () => {
    render(<Comisiones />)
    expect(screen.getByText('Comercial · Metas y comisiones')).toBeInTheDocument()
    // Tasas por línea (mock): Home Care 4.0% y Professional 6.0%.
    expect(screen.getByText(/Home Care: 4\.0%/)).toBeInTheDocument()
    expect(screen.getByText(/Professional: 6\.0%/)).toBeInTheDocument()
    expect(screen.getByText('Por vendedor')).toBeInTheDocument()
  })

  it('lista a los vendedores activos con su meta editable', () => {
    render(<Comisiones />)
    // Roster mock: Lucía · Ventas y Diego · Ventas (rol pos, activos).
    expect(screen.getAllByText(/Lucía/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Diego/).length).toBeGreaterThan(0)
    // La meta sembrada de ventas1 es 80000 → aparece en su input editable.
    expect(screen.getByDisplayValue('80000')).toBeInTheDocument()
  })
})

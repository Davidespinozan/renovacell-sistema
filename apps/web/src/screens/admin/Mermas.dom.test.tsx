// @vitest-environment jsdom
// Reporte de mermas valuadas: renderiza KPIs y la tabla, y alterna mes/histórico.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Mermas } from './Mermas'

beforeEach(cleanup)

describe('<Mermas>', () => {
  it('renderiza el encabezado y los KPIs de pérdida', () => {
    render(<Mermas />)
    expect(screen.getByText('Dirección · Mermas valuadas')).toBeInTheDocument()
    expect(screen.getByText('Pérdida por merma')).toBeInTheDocument()
    expect(screen.getByText('Unidades dadas de baja')).toBeInTheDocument()
  })

  it('permite alternar a histórico sin romper', () => {
    render(<Mermas />)
    fireEvent.click(screen.getByText('Histórico'))
    expect(screen.getByText('Eventos de merma')).toBeInTheDocument()
  })
})

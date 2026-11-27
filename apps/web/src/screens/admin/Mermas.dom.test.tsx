// @vitest-environment jsdom
// Reporte de mermas valuadas: renderiza KPIs y la tabla, y alterna mes/histórico.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { Mermas } from './Mermas'

beforeEach(cleanup)

describe('<Mermas>', () => {
  it('renderiza el encabezado y los KPIs de pérdida', () => {
    render(<Mermas />)
    expect(screen.getByText('Dirección · Mermas valuadas')).toBeInTheDocument()
    // Cada cifra aparece en su tarjeta y, además, explicada en el bloque «qué es» (27 nov).
    const tarjetas = document.querySelector('.sigs') as HTMLElement
    expect(within(tarjetas).getByText('Pérdida por merma')).toBeInTheDocument()
    expect(within(tarjetas).getByText('Unidades dadas de baja')).toBeInTheDocument()
    expect(screen.getByTestId('quees-mermas')).toHaveTextContent('Merma es producto que se perdió')
  })

  it('permite alternar a histórico sin romper', () => {
    render(<Mermas />)
    fireEvent.click(screen.getByText('Histórico'))
    expect(within(document.querySelector('.sigs') as HTMLElement).getByText('Eventos de merma')).toBeInTheDocument()
  })
})

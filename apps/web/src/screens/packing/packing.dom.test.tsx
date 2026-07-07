// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Cola } from './Cola'
import { Guias } from './Guias'
import { Recibo } from './Recibo'

beforeEach(cleanup)

describe('Empaque', () => {
  it('<Cola> muestra la cola de empaque', () => {
    renderWithRole(<Cola />)
    expect(screen.getByText('Empaque · Por empacar')).toBeInTheDocument()
  })
  it('<Guias> muestra las guías', () => {
    renderWithRole(<Guias />)
    expect(screen.getByText('Empaque · Guías')).toBeInTheDocument()
  })
  it('<Recibo> muestra el recibo de entrega (selección de envío)', () => {
    renderWithRole(<Recibo />)
    // Con envíos mock renderiza el selector; sin ellos, el encabezado del recibo.
    expect(screen.getAllByText(/Selecciona el envío|Recibo de entrega/).length).toBeGreaterThan(0)
  })
})

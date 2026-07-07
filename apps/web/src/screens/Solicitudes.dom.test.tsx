// @vitest-environment jsdom
// Test de Solicitudes de recurso (Diseño). Usa RoleProvider (lee user del contexto).
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { Solicitudes } from './Solicitudes'

beforeEach(cleanup)

describe('<Solicitudes>', () => {
  it('muestra las solicitudes sembradas con su estatus', () => {
    renderWithRole(<Solicitudes />)
    expect(screen.getByText('Diseño · Solicitudes y pendientes')).toBeInTheDocument()
    expect(screen.getByText('Banner para congreso CDMX')).toBeInTheDocument()
    expect(screen.getByText('Ficha visual Golden Serum')).toBeInTheDocument()
    // Estatus visibles
    expect(screen.getAllByText('Solicitado').length).toBeGreaterThan(0)
    expect(screen.getByText('En proceso')).toBeInTheDocument()
  })

  it('abre el modal de "Nuevo pendiente"', () => {
    renderWithRole(<Solicitudes />)
    fireEvent.click(screen.getByText('Nuevo pendiente'))
    expect(screen.getByText('Nuevo pendiente de diseño')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Campaña de lanzamiento/i)).toBeInTheDocument()
  })

  it('crea un pendiente propio y aparece en el tablero', () => {
    renderWithRole(<Solicitudes />)
    fireEvent.click(screen.getByText('Nuevo pendiente'))
    fireEvent.change(screen.getByPlaceholderText(/Campaña de lanzamiento/i), { target: { value: 'Rediseño de empaque' } })
    fireEvent.click(screen.getByText('Crear pendiente'))
    expect(screen.getByText('Rediseño de empaque')).toBeInTheDocument()
  })

  it('"Tomar" una solicitud la pasa a en proceso (aparece "Subir y entregar")', () => {
    renderWithRole(<Solicitudes />)
    const tomar = screen.getAllByText('Tomar')
    expect(tomar.length).toBeGreaterThan(0)
    fireEvent.click(tomar[0])
    expect(screen.getAllByText('Subir y entregar').length).toBeGreaterThan(0)
  })

  it('cerrar el modal de nuevo pendiente sin crear no agrega nada', () => {
    renderWithRole(<Solicitudes />)
    fireEvent.click(screen.getByText('Nuevo pendiente'))
    fireEvent.click(screen.getByText('Cancelar'))
    expect(screen.queryByText('Nuevo pendiente de diseño')).toBeNull()
  })
})

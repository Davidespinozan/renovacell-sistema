// @vitest-environment jsdom
// Vista Común: biblioteca, solicitudes de recurso y (para admin) el composer.
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { CommonView } from './CommonView'

beforeEach(cleanup)

describe('<CommonView>', () => {
  it('muestra la biblioteca y las solicitudes de recurso', () => {
    renderWithRole(<CommonView />)
    expect(screen.getByText('Biblioteca')).toBeInTheDocument()
    expect(screen.getByText('Solicitudes de recurso')).toBeInTheDocument()
  })

  it('abre el modal de subir asset', () => {
    renderWithRole(<CommonView />)
    fireEvent.click(screen.getByText('Subir asset'))
    // El modal tiene su propio encabezado + campo de etiquetas.
    expect(screen.getByPlaceholderText('logo, marca')).toBeInTheDocument()
  })

  it('permite solicitar un recurso al equipo', () => {
    renderWithRole(<CommonView />)
    fireEvent.click(screen.getByText(/Solicitar recurso/i))
    // Tras abrir el modal, "Solicitar recurso" está como botón y como título.
    expect(screen.getAllByText(/Solicitar recurso/i).length).toBeGreaterThan(1)
  })
})

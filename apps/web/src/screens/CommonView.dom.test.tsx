// @vitest-environment jsdom
// Vista Común: biblioteca, solicitudes de recurso y (para admin) el composer.
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { CommonView } from './CommonView'

beforeEach(() => { cleanup(); localStorage.clear() })   // Pestanas recuerda la pestaña elegida

describe('<CommonView>', () => {
  it('muestra la biblioteca y las solicitudes de recurso', () => {
    renderWithRole(<CommonView />)
    expect(screen.getByText('Biblioteca')).toBeInTheDocument()
    expect(screen.getByTestId('pestana-solicitudes')).toBeInTheDocument()
  })

  it('abre el modal de subir asset', () => {
    renderWithRole(<CommonView />)
    fireEvent.click(screen.getByTestId('pestana-biblioteca'))
    fireEvent.click(screen.getByText('Subir material'))
    // El modal tiene su propio encabezado + campo de etiquetas.
    expect(screen.getByPlaceholderText('logo, marca')).toBeInTheDocument()
  })

  it('permite solicitar un recurso al equipo', () => {
    renderWithRole(<CommonView />)
    fireEvent.click(screen.getByTestId('pestana-solicitudes'))
    fireEvent.click(screen.getByRole('button', { name: /Solicitar recurso/i }))
    // Tras abrir el modal, "Solicitar recurso" está como botón y como título.
    expect(screen.getAllByText(/Solicitar recurso/i).length).toBeGreaterThan(1)
  })

  it('el muro resalta lo nuevo y "Enterado" lo marca como leído', () => {
    renderWithRole(<CommonView />)
    const nuevos = screen.getAllByRole('button', { name: /^Enterado$/ })
    expect(nuevos.length).toBeGreaterThan(0)
    fireEvent.click(nuevos[0])
    expect(screen.getAllByRole('button', { name: /^Enterado$/ }).length).toBe(nuevos.length - 1)
  })

  it('publicar: la barra plegada abre el formulario y Cancelar lo cierra', () => {
    renderWithRole(<CommonView />)
    fireEvent.click(screen.getByText(/Publica un aviso o anuncio/))
    expect(screen.getByLabelText('Título')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('Título')).toBeNull()
  })
})

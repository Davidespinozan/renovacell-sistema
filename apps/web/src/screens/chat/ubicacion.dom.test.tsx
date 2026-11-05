// @vitest-environment jsdom
// UBICACIÓN EN EL CHAT · en el hilo se ve como tarjeta (nombre, dirección, «Abrir en Google Maps»), no como texto con un enlace largo.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { conEnlaces } from './ChatCanonico'
import { textoUbicacion } from '../../../../../supabase/functions/_shared/ubicacion'

afterEach(cleanup)
describe('tarjeta de ubicación', () => {
  it('nombre, dirección y enlace seguro a Maps', () => {
    render(<div>{conEnlaces(textoUbicacion({ nombre: 'Sucursal', direccion: 'Blvd. Pedro Infante 2911', lat: 24.8, lng: -107.39 }))}</div>)
    expect(screen.getByTestId('msg-ubicacion')).toHaveTextContent('Sucursal')
    expect(screen.getByText('Blvd. Pedro Infante 2911')).toBeInTheDocument()
    const a = screen.getByRole('link', { name: 'Abrir en Google Maps' })
    expect(a).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=24.8,-107.39')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })
  it('un texto normal sigue igual', () => {
    render(<div>{conEnlaces('Hola, aquí va: https://renovacell.mx')}</div>)
    expect(screen.queryByTestId('msg-ubicacion')).toBeNull()
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://renovacell.mx')
  })
})

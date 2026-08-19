// @vitest-environment jsdom
// Config de empresa: renderiza el formulario del emisor, valida RFC y solo habilita
// "Guardar" cuando hay cambios válidos.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Configuracion } from './Configuracion'

beforeEach(cleanup)

describe('<Configuracion>', () => {
  it('muestra el formulario del emisor y el régimen SAT', () => {
    render(<Configuracion />)
    expect(screen.getByText('Dirección · Configuración de la empresa')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Nombre legal de la empresa')).toBeInTheDocument()
    // El dropdown de régimen trae el catálogo SAT.
    expect(screen.getByText(/626 — Régimen Simplificado de Confianza/)).toBeInTheDocument()
  })

  it('bloquea Guardar sin cambios y con RFC inválido; lo habilita con RFC válido', () => {
    render(<Configuracion />)
    const guardar = screen.getByText('Guardar cambios').closest('button') as HTMLButtonElement
    expect(guardar).toBeDisabled() // sin cambios

    fireEvent.change(screen.getByPlaceholderText('XAXX010101000'), { target: { value: 'NOPE' } })
    expect(screen.getByText('RFC con formato inválido.')).toBeInTheDocument()
    expect(guardar).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('XAXX010101000'), { target: { value: 'XAXX010101000' } })
    expect(guardar).not.toBeDisabled()
  })
})

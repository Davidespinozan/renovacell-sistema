// @vitest-environment jsdom
// Config de empresa: renderiza el formulario del emisor, valida RFC y solo habilita
// "Guardar" cuando hay cambios válidos.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Configuracion, lineaOrigen } from './Configuracion'

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

describe('ORIGEN DE ENVÍOS ESTRUCTURADO (183)', () => {
  it('la línea de dirección se arma con calle, número y local; con los campos vacíos el texto legado sigue editable; el largo > 45 bloquea Guardar', () => {
    expect(lineaOrigen({ shipping_street: 'Nuevo Mundo', shipping_ext_number: '1045', shipping_int_number: '17' })).toEqual({ linea: 'Nuevo Mundo 1045 17', error: null })
    expect(lineaOrigen({ shipping_street: '', shipping_ext_number: '', shipping_int_number: '' })).toEqual({ linea: null, error: null })
    expect(lineaOrigen({ shipping_street: 'Nuevo Mundo', shipping_ext_number: '', shipping_int_number: '' }).error).toMatch(/número exterior/)
    expect(lineaOrigen({ shipping_street: 'Boulevard Licenciado Pedro Infante Cruz Norte', shipping_ext_number: '2911', shipping_int_number: '' }).error).toMatch(/45/)
    render(<Configuracion />)
    const linea = screen.getByTestId('origen-linea') as HTMLInputElement
    expect(linea.readOnly).toBe(false)   // sin campos estructurados: texto legado editable (DHL sigue igual)
    fireEvent.change(screen.getByLabelText('Calle del origen'), { target: { value: 'Nuevo Mundo' } })
    expect(screen.getByTestId('origen-error')).toHaveTextContent(/número exterior/)
    fireEvent.change(screen.getByLabelText('Número exterior del origen'), { target: { value: '1045' } })
    fireEvent.change(screen.getByLabelText('Número interior del origen'), { target: { value: '17' } })
    expect(screen.queryByTestId('origen-error')).toBeNull()
    expect((screen.getByTestId('origen-linea') as HTMLInputElement).value).toBe('Nuevo Mundo 1045 17')
    expect((screen.getByTestId('origen-linea') as HTMLInputElement).readOnly).toBe(true)
    fireEvent.change(screen.getByLabelText('Colonia del origen'), { target: { value: 'Las Quintas' } })
    fireEvent.change(screen.getByLabelText('Referencias del origen'), { target: { value: 'Local 17, frente al parque' } })
    expect(screen.getByLabelText('Colonia del origen')).toHaveValue('Las Quintas')
  })
})

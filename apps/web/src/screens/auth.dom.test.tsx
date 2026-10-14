// @vitest-environment jsdom
// Tests de las pantallas de acceso: Login y "cuenta en revisión" (doctor no verif.).
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { Login } from './Login'

beforeEach(cleanup)

describe('<Login>', () => {
  it('muestra el formulario de inicio de sesión', () => {
    renderWithRole(<Login />)
    expect(screen.getByText('Iniciar sesión')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('tu@correo.com')).toBeInTheDocument()
  })
  it('permite capturar correo y contraseña', () => {
    renderWithRole(<Login />)
    const email = screen.getByPlaceholderText('tu@correo.com') as HTMLInputElement
    fireEvent.change(email, { target: { value: 'direccion@renovacell.mx' } })
    expect(email.value).toBe('direccion@renovacell.mx')
  })
  it('"Verifica tu cédula" lleva al ÚNICO registro de doctores (el de la landing), no a un formulario corto', () => {
    renderWithRole(<Login />)
    const ir = screen.getByTestId('ir-registro-medico') as HTMLAnchorElement
    expect(ir.getAttribute('href')).toMatch(/\/#contacto$/)
    expect(screen.queryByText('Crear cuenta médica')).toBeNull(); expect(screen.queryByPlaceholderText('Número de cédula')).toBeNull()
  })
})

// @vitest-environment jsdom
// Tests de las pantallas de acceso: Login y "cuenta en revisión" (doctor no verif.).
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { Login } from './Login'
import { ReviewPending } from './ReviewPending'

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
})

describe('<ReviewPending>', () => {
  it('muestra el aviso de cuenta en revisión (doctor no verificado)', () => {
    renderWithRole(<ReviewPending />)
    expect(screen.getByText(/en revisión/)).toBeInTheDocument()
  })
})

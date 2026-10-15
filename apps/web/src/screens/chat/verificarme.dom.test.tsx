// @vitest-environment jsdom
// VERIFICARME EN EL CHAT · la tarjeta pide solo lo que falta, valida antes de enviar, crea la cuenta y entra; si el
// correo ya tiene cuenta, lo dice y ofrece iniciar sesión. Y las reglas del servidor.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TarjetaVerificarme } from './TarjetaVerificarme'
import { validarVerificarme } from '../../../../../supabase/functions/_shared/visitante'
import edge from '../../../../../supabase/functions/visitor/index.ts?raw'

afterEach(cleanup)
const datos = async () => ({ nombre: 'Magaly B', email: 'magaly@x.mx', telefono: '6672556669', cedula: null })
const foto = () => new File(['x'], 'ine.jpg', { type: 'image/jpeg' })

describe('Verificar mi cuenta (en el chat)', () => {
  it('muestra los datos que ya dejó, valida y crea la cuenta con cédula, INE y contraseña; luego entra', async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: true, email: 'magaly@x.mx' }); const entrar = vi.fn().mockResolvedValue(true)
    render(<TarjetaVerificarme onCerrar={() => {}} leer={datos} enviar={enviar} entrar={entrar} reducir={async () => 'data:image/jpeg;base64,/9j/AA=='} />)
    await screen.findByText(/magaly@x\.mx/)
    fireEvent.click(screen.getByTestId('vm-crear'))
    expect(screen.getByRole('alert').textContent).toMatch(/cédula/); expect(enviar).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Cédula profesional'), { target: { value: '12 345 678' } })
    fireEvent.change(screen.getByTestId('vm-frente'), { target: { files: [foto()] } }); await screen.findByAltText('INE frente')
    fireEvent.change(screen.getByTestId('vm-reverso'), { target: { files: [foto()] } }); await screen.findByAltText('INE reverso')
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto123' } })
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'secreto123' } })
    fireEvent.click(screen.getByTestId('vm-crear'))
    await screen.findByTestId('verificarme-lista')
    expect(enviar).toHaveBeenCalledWith({ cedula: '12345678', password: 'secreto123', ineFront: 'data:image/jpeg;base64,/9j/AA==', ineBack: 'data:image/jpeg;base64,/9j/AA==' })
    expect(entrar).toHaveBeenCalledWith('magaly@x.mx', 'secreto123')
  })
  it('si su correo ya tiene cuenta, lo dice y ofrece iniciar sesión', async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: false, mensaje: 'Ya hay una cuenta con magaly@x.mx. Inicia sesión con ella.', codigo: 'correo_con_cuenta' })
    render(<TarjetaVerificarme onCerrar={() => {}} leer={datos} enviar={enviar} reducir={async () => 'data:image/jpeg;base64,/9j/AA=='} />)
    await screen.findByText(/magaly@x\.mx/)
    fireEvent.change(screen.getByLabelText('Cédula profesional'), { target: { value: '1234567' } })
    fireEvent.change(screen.getByTestId('vm-frente'), { target: { files: [foto()] } }); await screen.findByAltText('INE frente')
    fireEvent.change(screen.getByTestId('vm-reverso'), { target: { files: [foto()] } }); await screen.findByAltText('INE reverso')
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto123' } }); fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'secreto123' } })
    fireEvent.click(screen.getByTestId('vm-crear'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Ya hay una cuenta/))
    expect((screen.getByRole('alert').querySelector('a') as HTMLAnchorElement).getAttribute('href')).toBe('/sistema')
  })
})

describe('Verificarme (servidor)', () => {
  it('cédula solo números (5 a 12) y contraseña de 8 a 72', () => {
    expect(validarVerificarme({ cedula: '12 345 678', password: 'secreto123' })).toEqual({ ok: true, cedula: '12345678', password: 'secreto123' })
    expect(validarVerificarme({ cedula: '12-AB', password: 'secreto123' })).toMatchObject({ ok: false, campo: 'cedula' })
    expect(validarVerificarme({ cedula: '1234567', password: 'corta' })).toMatchObject({ ok: false, campo: 'password' })
  })
  it('usa el correo del PRERREGISTRO, exige las dos fotos, no duplica cuentas, deshace si algo falla y la deja pendiente', () => {
    const b = edge.slice(edge.indexOf("if (action === 'verificarme')"), edge.indexOf('// adoptar: sesión obligatoria'))
    expect(b).toMatch(/admin\.rpc\('cc_prerregistro_datos'/); expect(b).toMatch(/createUser\(\{ email: d\.email/)
    expect(b).toMatch(/!frente \|\| frente === 'invalida' \|\| !reverso \|\| reverso === 'invalida'/)
    expect(b.indexOf("ilike('email', d.email)")).toBeLessThan(b.indexOf('createUser'))
    expect(b).toMatch(/verification: \{ status: 'pending' \}/); expect(b).not.toMatch(/verified: true/)
    expect(b).toMatch(/await deshacer\(\)/); expect(b).toMatch(/cc_visitante_vincular_registro/)
  })
})

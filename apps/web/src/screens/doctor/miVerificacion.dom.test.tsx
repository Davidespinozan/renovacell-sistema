// @vitest-environment jsdom
// MI VERIFICACIÓN · la franja consulta sola y desbloquea al aprobarse; rechazado muestra el motivo; la pantalla deja
// corregir cédula e INE y manda solo lo que cambió. Validación de fotos del servidor.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { AvisoVerificacion, textoFaltan } from './AvisoVerificacion'
import { MiVerificacion } from './MiVerificacion'
import { decodificarFoto, validarCompletar } from '../../../../../supabase/functions/_shared/verificacion'
import type { MiVerificacion as Estado } from '../../data/ops/verificacion'

const h = vi.hoisted(() => ({ actualizar: vi.fn(), setScreen: vi.fn() }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ actualizarVerificacion: h.actualizar, setScreen: h.setScreen }) }))
afterEach(() => { cleanup(); h.actualizar.mockReset(); h.setScreen.mockReset() })
const est = (x: Partial<Estado>): Estado => ({ verificado: false, estado: 'pending', motivo: null, revisado_at: null, cedula: null, faltan: [], ...x })

describe('Franja de verificación', () => {
  it('pendiente con faltantes: los dice y lleva a Mi verificación', async () => {
    render(<AvisoVerificacion leer={async () => est({ faltan: ['cedula', 'ine-back'] })} />)
    await waitFor(() => expect(screen.getByTestId('aviso-verificacion').textContent).toMatch(/tu cédula profesional y la foto del reverso de tu INE/))
    fireEvent.click(screen.getByTestId('ir-mi-verificacion')); expect(h.setScreen).toHaveBeenCalledWith('mi_verificacion')
  })
  it('rechazado: muestra el motivo', async () => {
    render(<AvisoVerificacion leer={async () => est({ estado: 'rejected', motivo: 'Falta el reverso del INE' })} />)
    await waitFor(() => expect(screen.getByTestId('aviso-verificacion').textContent).toMatch(/No pudimos aprobar tu verificación\. Motivo: Falta el reverso del INE/))
  })
  it('aprobado: desbloquea el portal sin volver a entrar', async () => {
    render(<AvisoVerificacion leer={async () => est({ verificado: true, estado: 'verified' })} />)
    await waitFor(() => expect(h.actualizar).toHaveBeenCalledWith(true))
  })
  it('lista legible de faltantes', () => { expect(textoFaltan(['cedula'])).toBe('tu cédula profesional'); expect(textoFaltan(['cedula', 'ine-front', 'ine-back'])).toBe('tu cédula profesional, la foto del frente de tu INE y la foto del reverso de tu INE') })
})

describe('Mi verificación', () => {
  it('corrige cédula y fotos; manda solo lo capturado y queda en revisión', async () => {
    const completar = vi.fn().mockResolvedValue({ ok: true })
    let n = 0; const leer = vi.fn(async () => (n++ === 0 ? est({ estado: 'rejected', motivo: 'Cédula ilegible', cedula: '123', faltan: ['ine-back'] }) : est({})))
    render(<MiVerificacion leer={leer} completar={completar} reducir={async () => 'data:image/jpeg;base64,/9j/AA=='} />)
    expect((await screen.findByTestId('mi-verificacion-motivo')).textContent).toMatch(/Cédula ilegible/)
    fireEvent.change(screen.getByLabelText('Cédula profesional'), { target: { value: '1234567' } })
    fireEvent.change(screen.getByTestId('mi-ine-reverso'), { target: { files: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })] } })
    await screen.findByAltText('INE reverso')
    fireEvent.click(screen.getByTestId('mi-verificacion-enviar'))
    await waitFor(() => expect(completar).toHaveBeenCalledWith({ cedula: '1234567', ineFront: null, ineBack: 'data:image/jpeg;base64,/9j/AA==' }))
    expect(await screen.findByText(/lo revisaremos/)).toBeTruthy()
  })
  it('ya verificado: lo dice y desbloquea', async () => {
    render(<MiVerificacion leer={async () => est({ verificado: true, estado: 'verified' })} />)
    await screen.findByTestId('mi-verificacion-ok'); expect(h.actualizar).toHaveBeenCalledWith(true)
  })
})

describe('Servidor: fotos válidas', () => {
  it('solo JPG o PNG reales, bajo el límite; algo que mandar', () => {
    expect(decodificarFoto(null)).toBeNull()
    const ok = decodificarFoto('data:image/jpeg;base64,/9j/AA=='); expect(ok && ok !== 'invalida' && ok.ext).toBe('jpg')
    expect(decodificarFoto('data:image/jpeg;base64,iVBORw==')).toBe('invalida')          // dice JPEG pero es PNG
    expect(decodificarFoto('data:text/html;base64,PGh0bWw+')).toBe('invalida')
    expect(validarCompletar({})).toEqual({ ok: false, mensaje: 'Manda al menos un dato: cédula o fotos del INE.' })
    expect(validarCompletar({ cedula: '12' })).toMatchObject({ ok: false })
    expect(validarCompletar({ cedula: '1234567' })).toMatchObject({ ok: true, cedula: '1234567', ineFront: null })
  })
})

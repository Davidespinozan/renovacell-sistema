// @vitest-environment jsdom
// ALTA COMPLETA · valida todo antes de crear; crea y guarda cada parte con el comando de la ficha; no toca a quien ya
// existía; dice qué parte opcional no se guardó; la vendedora no captura facturación ni asigna vendedora.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { AltaClienteForm, avisoAlta, erroresAlta } from './AltaCliente'
import { emptyFiscalProfile } from '../../data/ops/fiscal'

const h = vi.hoisted(() => ({ role: 'admin' }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: h.role }) }))
afterEach(() => { cleanup(); h.role = 'admin' })

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data })
const falsos = () => {
  const c360 = { guardarCedula: vi.fn(() => ok({})), guardarTelefono: vi.fn(() => ok({ id: 't' })), guardarDomicilio: vi.fn(() => ok({ id: 'd' })),
    guardarFiscal: vi.fn(() => ok({ id: 'f' })), asignarVendedor: vi.fn(() => ok({})), agregarNota: vi.fn(() => ok({})) }
  const perfil = { guardar: vi.fn(() => ok({})), especialidades: vi.fn(() => Promise.resolve([{ clave: 'derma', nombre: 'Dermatología', orden: 1, activa: true }])) }
  const atencion = { vendedores: vi.fn(() => ok([{ id: 'V1', nombre: 'Roberto', activo: true, conversaciones: true, nuevos_clientes: true, elegible: true, elegible_nuevos: true, clientes: 3 }])) }
  return { c360, perfil, atencion }
}
const rpcCrea = (status = 'creado') => vi.fn(async () => ({ data: { status, customer_id: 'C1', nombre: 'DRA ANA', phone: '6671234567' }, error: null }))
const montar = (rpc: ReturnType<typeof rpcCrea>, f: ReturnType<typeof falsos>, onListo = vi.fn()) => {
  render(<AltaClienteForm onListo={onListo} onCancelar={() => {}} rpc={rpc as never} c360={f.c360 as never} perfil={f.perfil as never} atencion={f.atencion as never} />)
  return onListo
}
const llenarBase = () => {
  fireEvent.change(screen.getByTestId('prospecto-nombre'), { target: { value: 'Dra. Ana López' } })
  fireEvent.change(screen.getByTestId('prospecto-celular'), { target: { value: '667 123 4567' } })
}

describe('Alta completa', () => {
  it('valida antes de crear (no se crea nada si algo está mal)', () => {
    const dom = { tipo: 'CASA', line1: 'Obregón', exterior_number: '', interior_number: '', neighborhood: '', postal_code: '800', city: '', state: '', reference_notes: '' }
    expect(erroresAlta({ nombre: 'Ana López', celular: '6671234567', correo: 'x', cedula: '123', tel2: '12', dom, fiscal: { ...emptyFiscalProfile(), rfc: 'MAL' } }))
      .toEqual(['Revisa el correo.', 'La cédula profesional tiene 7 u 8 dígitos.', 'El otro teléfono debe tener de 10 a 15 dígitos.', 'Domicilio: el código postal tiene 5 dígitos.', 'Domicilio: falta la ciudad.', 'Domicilio: falta el estado.', 'Facturación: revisa los datos fiscales marcados.'])
  })
  it('Dirección: crea y guarda especialidad, cédula, teléfono, domicilio, vendedora y nota con los comandos de la ficha', async () => {
    const f = falsos(); const rpc = rpcCrea()
    const onListo = montar(rpc, f)
    llenarBase()
    await waitFor(() => expect(screen.getByTestId('alta-especialidad').querySelectorAll('option').length).toBe(2))
    fireEvent.change(screen.getByTestId('alta-especialidad'), { target: { value: 'derma' } })
    fireEvent.change(screen.getByTestId('alta-cedula'), { target: { value: '1234567' } })
    fireEvent.change(screen.getByTestId('alta-tel2'), { target: { value: '667 700 0000' } })
    fireEvent.change(screen.getByTestId('alta-calle'), { target: { value: 'Av. Obregón 100' } })
    fireEvent.change(screen.getByTestId('alta-cp'), { target: { value: '80000' } })
    fireEvent.change(screen.getByTestId('alta-estado'), { target: { value: 'Sinaloa' } })
    fireEvent.change(screen.getByTestId('alta-ciudad-dom'), { target: { value: 'Culiacán' } })
    await waitFor(() => expect(screen.getByTestId('alta-vendedora').querySelectorAll('option').length).toBe(2))
    fireEvent.change(screen.getByTestId('alta-vendedora'), { target: { value: 'V1' } })
    fireEvent.change(screen.getByTestId('alta-nota'), { target: { value: 'Prefiere mañanas' } })
    fireEvent.click(screen.getByTestId('prospecto-guardar'))
    await waitFor(() => expect(onListo).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 'C1', faltas: [] })))
    expect(rpc).toHaveBeenCalledWith('cliente_prospecto_crear', expect.objectContaining({ p_nombre: 'Dra. Ana López', p_tipo: 'doctor' }))
    expect(f.perfil.guardar).toHaveBeenCalledWith('C1', 'doctor', 'derma', null)
    expect(f.c360.guardarCedula).toHaveBeenCalledWith('C1', '1234567')
    expect(f.c360.guardarTelefono).toHaveBeenCalledWith('C1', null, '667 700 0000', 'consultorio', false)
    expect(f.c360.guardarDomicilio).toHaveBeenCalledWith('C1', null, expect.objectContaining({ name: 'Consultorio', line1: 'Av. Obregón 100', postal_code: '80000', city: 'Culiacán', state: 'Sinaloa', country: 'México' }), true)
    expect(f.c360.asignarVendedor).toHaveBeenCalledWith('C1', 'V1', 'Asignada al darlo de alta')
    expect(f.c360.agregarNota).toHaveBeenCalledWith('C1', 'Prefiere mañanas')
    expect(f.c360.guardarFiscal).not.toHaveBeenCalled()   // sin RFC no se guarda facturación
  })
  it.each(['existente', 'asignado'])('si el celular ya existía (%s), no toca su ficha', async (st) => {
    const f = falsos(); const onListo = montar(rpcCrea(st), f)
    llenarBase(); fireEvent.change(screen.getByTestId('alta-cedula'), { target: { value: '1234567' } })
    fireEvent.click(screen.getByTestId('prospecto-guardar'))
    await waitFor(() => expect(onListo).toHaveBeenCalledWith(expect.objectContaining({ status: st, faltas: [] })))
    expect(f.c360.guardarCedula).not.toHaveBeenCalled()
  })
  it('una parte opcional que falla no tumba el alta: queda dicho qué faltó', async () => {
    const f = falsos(); f.c360.guardarCedula = vi.fn(() => Promise.resolve({ ok: false as const, error: 'Esa cédula ya está registrada: «Dr. X».' })) as never
    const onListo = montar(rpcCrea(), f)
    llenarBase(); fireEvent.change(screen.getByTestId('alta-cedula'), { target: { value: '1234567' } })
    fireEvent.click(screen.getByTestId('prospecto-guardar'))
    await waitFor(() => expect(onListo).toHaveBeenCalled())
    const r = onListo.mock.calls[0][0]
    expect(r.faltas).toEqual(['Cédula: Esa cédula ya está registrada: «Dr. X».'])
    expect(avisoAlta(r, 'direccion')).toMatch(/quedó registrado\. No se pudo guardar: Cédula/)
  })
  it('la vendedora no ve facturación ni elige vendedora', () => {
    h.role = 'pos'
    montar(rpcCrea(), falsos())
    expect(screen.queryByTestId('alta-vendedora')).toBeNull()
    expect(screen.getByText(/Los datos de facturación los captura Dirección/)).toBeTruthy()
  })
})

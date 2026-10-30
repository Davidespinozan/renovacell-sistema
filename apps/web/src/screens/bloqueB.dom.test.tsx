// @vitest-environment jsdom
// HERRAMIENTAS DEL VENDEDOR · bloque B: clasificar a cada cliente como Doctor o Clínica y su especialidad (lista + "Otra"),
// rápido desde "Clasifica tu cartera" y desde la ficha/chat; se guarda al elegir.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ClasificarCartera } from './ClasificarCartera'
import { PerfilComercialEditor, olvidarEspecialidades } from '../app/PerfilComercialEditor'
import type { ClientePerfilComercial } from '../data/ops/perfilComercial'

vi.mock('../auth/RoleContext', () => ({ useRoleOpcional: () => ({ role: 'pos' }) }))
afterEach(() => { cleanup(); olvidarEspecialidades() })
const ESP = [{ clave: 'dermatologia', nombre: 'Dermatología', orden: 20, activa: true }, { clave: 'otra', nombre: 'Otra', orden: 1000, activa: true }]

function falso() {
  const filas = [{ customer_id: 'C1', nombre: 'LAURA GOMEZ', ciudad: 'Culiacán', tipo: null, especialidad: null, especialidad_otra: null }]
  return {
    especialidades: vi.fn(async () => ESP),
    misClientes: vi.fn(async () => ({ ok: true as const, data: { total: 10, clasificados: 4, doctores: 3, clinicas: 1, encontrados: 1, clientes: filas } })),
    guardar: vi.fn(async (_c: string, tipo: string | null, especialidad: string | null, otra: string | null) => ({ ok: true as const, data: { tipo, especialidad, especialidad_nombre: null, especialidad_otra: otra, especialidad_portal: null, puede_editar: true } })),
    perfil: vi.fn(async () => ({ ok: true as const, data: { tipo: 'doctor', especialidad: null, especialidad_nombre: null, especialidad_otra: null, especialidad_portal: null, puede_editar: true } })),
    agregarEspecialidad: vi.fn(),
  }
}

describe('Clasifica tu cartera', () => {
  it('muestra el avance; un toque marca Doctor, luego la especialidad; se guarda al elegir', async () => {
    const c = falso()
    render(<ClasificarCartera cliente={c as unknown as ClientePerfilComercial} abiertoInicial />)
    await waitFor(() => expect(screen.getByTestId('clasificar-abrir')).toHaveTextContent('4 de 10 clasificados · 3 doctores · 1 clínica'))
    const fila = await screen.findByTestId('clasificar-fila')
    expect(fila).toHaveTextContent('Laura Gomez')
    fireEvent.click(fila.querySelector('[data-testid=tipo-doctor]')!)
    await waitFor(() => expect(c.guardar).toHaveBeenCalledWith('C1', 'doctor', null, null))
    await waitFor(() => expect(screen.getByTestId('clasificar-abrir')).toHaveTextContent('5 de 10 clasificados · 4 doctores'))
    fireEvent.change(fila.querySelector('[data-testid=especialidad]')!, { target: { value: 'dermatologia' } })
    await waitFor(() => expect(c.guardar).toHaveBeenLastCalledWith('C1', 'doctor', 'dermatologia', null))
  })
  it('"Otra" espera a que escriba cuál y entonces guarda', async () => {
    const c = falso()
    render(<ClasificarCartera cliente={c as unknown as ClientePerfilComercial} abiertoInicial />)
    const fila = await screen.findByTestId('clasificar-fila')
    await waitFor(() => expect(fila.querySelectorAll('option')).toHaveLength(3))
    fireEvent.change(fila.querySelector('[data-testid=especialidad]')!, { target: { value: 'otra' } })
    expect(c.guardar).not.toHaveBeenCalled()
    const otra = await screen.findByTestId('especialidad-otra')
    fireEvent.change(otra, { target: { value: 'Medicina regenerativa' } }); fireEvent.blur(otra)
    await waitFor(() => expect(c.guardar).toHaveBeenCalledWith('C1', null, 'otra', 'Medicina regenerativa'))
  })
})

describe('Editor en la ficha y en el chat', () => {
  it('carga lo guardado y guarda al cambiar; si no puede verlo, no se muestra', async () => {
    const c = falso()
    render(<PerfilComercialEditor customerId="C9" cliente={c as unknown as ClientePerfilComercial} />)
    const caja = await screen.findByTestId('perfil-comercial')
    expect(caja.querySelector('[data-testid=tipo-doctor]')!.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(caja.querySelector('[data-testid=tipo-clinica]')!)
    await waitFor(() => expect(c.guardar).toHaveBeenCalledWith('C9', 'clinica', null, null))
    expect(await screen.findByText('Guardado')).toBeTruthy()
    cleanup()
    const sin = { ...falso(), perfil: vi.fn(async () => ({ ok: false as const, mensaje: 'No puedes clasificar a este cliente.' })) }
    const { container } = render(<PerfilComercialEditor customerId="C9" cliente={sin as unknown as ClientePerfilComercial} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.innerHTML).toBe('')
  })
})

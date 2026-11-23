// @vitest-environment jsdom
// CLIENTES REPETIDOS · la que tiene pedidos se queda por omisión y no se puede archivar; aviso cuando los nombres no se
// parecen; fusionar manda la que se queda y las que se van; «Son distintos» manda todo el grupo.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ClientesRepetidos, nombresParecidos, quedaPorOmision, type GrupoRepetido } from './ClientesRepetidos'

const h = vi.hoisted(() => ({ ok: true }))
vi.mock('../../app/dialogos', () => ({ confirmar: vi.fn(async () => h.ok) }))
afterEach(() => cleanup())

const f = (id: string, nombre: string, x: Partial<GrupoRepetido['fichas'][0]> = {}) => ({ id, nombre, correo: null, telefono: '6671112233', ciudad: null, origen: 'odoo', portal: false, cedula: false, vendedor: null, pedidos: 0, total: 0, creado: '2026-10-01T00:00:00Z', ...x })
const grupo: GrupoRepetido = { ids: ['A', 'B', 'C'], por: ['telefono'], fichas: [f('A', 'Dra Ana López'), f('B', 'ANA LOPEZ PEREZ', { pedidos: 2, total: 5000 }), f('C', 'Pablo Gómez')] }

describe('Clientes repetidos', () => {
  it('reglas puras: nombres parecidos y la que se queda por omisión', () => {
    expect(nombresParecidos('Dra Ana López', 'ANA LOPEZ PEREZ')).toBe(true)
    expect(nombresParecidos('Juana Selene Rosas Carrillo', 'Pablo Alfonso López González')).toBe(false)
    expect(quedaPorOmision(grupo)).toBe('B')   // la que tiene pedidos
  })
  it('fusiona en la que tiene pedidos y avisa del nombre distinto; no deja archivar la que tiene pedidos', async () => {
    const rpc = vi.fn(async (fn: string) => (fn === 'clientes_duplicados' ? { data: [grupo], error: null } : { data: {}, error: null }))
    render(<ClientesRepetidos rpc={rpc} />)
    await screen.findByTestId('grupo-repetido')
    expect(screen.getAllByText(/Nombre distinto/).length).toBe(1)   // Pablo frente a Ana
    fireEvent.click(screen.getByTestId('repetidos-fusionar'))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('clientes_fusionar', expect.objectContaining({ p_queda: 'B', p_se_van: ['A', 'C'] })))
    // si se elige como «se queda» una sin pedidos, la de pedidos no se ofrece para fusionar
    cleanup(); render(<ClientesRepetidos rpc={rpc} />)
    await screen.findByTestId('grupo-repetido')
    fireEvent.click(screen.getByLabelText('Se queda Dra Ana López'))
    expect(screen.getByText(/Tiene pedidos: elígela como la que se queda/)).toBeTruthy()
  })
  it('«Son distintos» manda todo el grupo y lo quita de la lista', async () => {
    const rpc = vi.fn(async (fn: string) => (fn === 'clientes_duplicados' ? { data: [grupo], error: null } : { data: 3, error: null }))
    render(<ClientesRepetidos rpc={rpc} />)
    fireEvent.click(await screen.findByTestId('repetidos-distintos'))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('clientes_marcar_distintos', { p_ids: ['A', 'B', 'C'] }))
    await waitFor(() => expect(screen.queryByTestId('grupo-repetido')).toBeNull())
  })
  it('los obvios se fusionan en un clic y la lista se recarga', async () => {
    let llamadas = 0
    const obvio: GrupoRepetido = { ids: ['T1', 'T2'], por: ['telefono'], obvio: true, fichas: [f('T1', 'MARIA TERESA SALAS HERNANDEZ'), f('T2', 'Tere Salas')] }
    const rpc = vi.fn(async (fn: string) => (fn === 'clientes_duplicados' ? { data: llamadas++ === 0 ? [obvio, grupo] : [grupo], error: null } : { data: { grupos: 1 }, error: null }))
    render(<ClientesRepetidos rpc={rpc} />)
    fireEvent.click(await screen.findByTestId('repetidos-fusionar-obvios'))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('clientes_fusionar_obvios'))
    await waitFor(() => expect(screen.queryByTestId('repetidos-obvios')).toBeNull())
    expect(screen.getAllByTestId('grupo-repetido').length).toBe(1)
  })
})

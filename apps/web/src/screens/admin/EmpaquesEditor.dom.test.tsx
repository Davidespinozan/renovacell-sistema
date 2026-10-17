// @vitest-environment jsdom
// EMP-1 · Dirección administra el catálogo de empaques: lista (la más usada primero), agrega con medidas válidas,
// marca "más usada" y desactiva sin borrar. Todo por empaque_guardar (nunca escrituras directas).
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { EmpaquesEditor } from './EmpaquesEditor'
import type { Empaque } from '../../data/ops/empaques'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn() } }))
beforeEach(cleanup)
const E = (id: string, x: Partial<Empaque> = {}): Empaque => ({ id, nombre: 'Caja ' + id, tipo: 'caja', largo_cm: 20, ancho_cm: 20, alto_cm: 20, peso_kg: null, nota: null, frecuente: false, activo: true, orden: 100, ...x })

describe('EMP-1 · EmpaquesEditor', () => {
  it('lista el catálogo y agrega uno nuevo por el comando', async () => {
    const lista = [E('h4', { nombre: 'Hielera chica #4', tipo: 'hielera', frecuente: true, nota: 'La que se utiliza más' }), E('c1')]
    const guardar = vi.fn(async (d: unknown) => ({ ok: true as const, data: { ...E('n1'), ...(d as object) } }))
    const listar = vi.fn(async () => ({ ok: true as const, data: lista }))
    render(<EmpaquesEditor listar={listar} guardar={guardar} />)
    await waitFor(() => expect(screen.getByTestId('empaque-h4')).toHaveTextContent(/Hielera chica #4/))
    expect(screen.getByTestId('empaque-h4')).toHaveTextContent(/Más usada/); expect(screen.getByTestId('empaque-h4')).toHaveTextContent(/20×20×20 cm/)
    expect(listar).toHaveBeenCalledWith(true)   // también los inactivos, para administrarlos
    fireEvent.click(screen.getByTestId('empaque-nuevo'))
    expect((screen.getByTestId('empaque-guardar') as HTMLButtonElement).disabled).toBe(true)   // sin nombre ni medidas no se guarda
    fireEvent.change(screen.getByLabelText('Nombre del empaque'), { target: { value: 'Caja mediana' } })
    for (const k of ['largo_cm', 'ancho_cm', 'alto_cm']) fireEvent.change(screen.getByLabelText(k), { target: { value: '25' } })
    fireEvent.click(screen.getByTestId('empaque-guardar'))
    await waitFor(() => expect(guardar).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Caja mediana', tipo: 'caja', largo_cm: 25, ancho_cm: 25, alto_cm: 25 })))
    expect(listar).toHaveBeenCalledTimes(2)   // recarga tras guardar
  })
  it('marcar más usada y desactivar mandan solo ese cambio; el error del servidor se muestra', async () => {
    const guardar = vi.fn(async () => ({ ok: false as const, error: 'Ya hay un empaque con ese nombre.' }))
    render(<EmpaquesEditor listar={async () => ({ ok: true, data: [E('c1'), E('c2', { activo: false })] })} guardar={guardar} />)
    await waitFor(() => expect(screen.getByTestId('empaque-c1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('empaque-frecuente-c1'))
    await waitFor(() => expect(guardar).toHaveBeenCalledWith({ id: 'c1', frecuente: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Ya hay un empaque/)
    fireEvent.click(screen.getByTestId('empaque-activo-c2'))
    await waitFor(() => expect(guardar).toHaveBeenCalledWith({ id: 'c2', activo: true }))
    expect(screen.getByTestId('empaque-c2')).toHaveTextContent(/Inactivo/)
  })
})

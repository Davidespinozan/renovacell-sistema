// @vitest-environment jsdom
// Paginación real del directorio: 250 customers → 3 páginas de 100; navegar; reset al buscar.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, cleanup, within } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import type { Customer } from '../data/ops/customer'

const mk = (i: number): Customer => ({
  id: `c${i}`, full_name: `Cliente ${String(i).padStart(3, '0')}`, email: null, phone: null, city: null,
  country: null, seller_name: 'Alejandra', external_id: null, source: 'odoo', import_hash: `h${i}`,
  profile_id: i === 1 ? 'p1' : null, meta: {}, active: true, created_at: 'T0', updated_at: 'T0',
})
const SAMPLE: Customer[] = Array.from({ length: 250 }, (_, i) => mk(i + 1))

vi.mock('../data/hooks/useCustomers', async (importActual) => {
  const actual = await importActual<typeof import('../data/hooks/useCustomers')>()
  return { ...actual, useCustomers: () => ({ data: SAMPLE, loading: false, error: null, reload: async () => {} }) }
})

import { CustomerDirectory } from './CustomerDirectory'

afterEach(cleanup)

describe('<CustomerDirectory> paginación (250 → 3 páginas)', () => {
  it('página 1: muestra 1–100 de 250, Página 1 de 3, no renderiza los 250', () => {
    renderWithRole(<CustomerDirectory title="Doctores" scope="all" />)
    expect(screen.getByText(/Mostrando 1–100 de 250 · Página 1 de 3/)).toBeTruthy()
    expect(screen.getByText('Cliente 001')).toBeTruthy()
    expect(screen.getByText('Cliente 100')).toBeTruthy()
    expect(screen.queryByText('Cliente 101')).toBeNull() // no en la página 1
    expect(screen.queryByText('Cliente 250')).toBeNull()
  })
  it('Siguiente → página 2 (101–200)', () => {
    renderWithRole(<CustomerDirectory title="Doctores" scope="all" />)
    fireEvent.click(screen.getByText('Siguiente'))
    expect(screen.getByText(/Mostrando 101–200 de 250 · Página 2 de 3/)).toBeTruthy()
    expect(screen.getByText('Cliente 101')).toBeTruthy()
    expect(screen.queryByText('Cliente 001')).toBeNull()
  })
  it('ir a página 3 por número (201–250, 50 registros)', () => {
    renderWithRole(<CustomerDirectory title="Doctores" scope="all" />)
    const nums = document.querySelector('.pg-nums') as HTMLElement
    fireEvent.click(within(nums).getByText('3'))
    expect(screen.getByText(/Mostrando 201–250 de 250 · Página 3 de 3/)).toBeTruthy()
    expect(screen.getByText('Cliente 250')).toBeTruthy()
  })
  it('buscar (sobre TODOS) resetea a página 1 y filtra antes de paginar', () => {
    renderWithRole(<CustomerDirectory title="Doctores" scope="all" />)
    fireEvent.click(screen.getByText('Siguiente')) // ir a página 2
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), { target: { value: 'Cliente 137' } })
    expect(screen.getByText('Cliente 137')).toBeTruthy() // estaba en pág 2, la búsqueda global lo encuentra
    expect(screen.getByText(/Mostrando 1–1 de 1 · Página 1 de 1/)).toBeTruthy()
  })
})

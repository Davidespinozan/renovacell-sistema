// @vitest-environment jsdom
// Directorio comercial (Clientes) — render, búsqueda inmediata y detalle, con customers de prueba.
// Se mockea SOLO el hook de carga (useCustomers); el filtro (useCustomerSearch/filterCustomers) es real.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import type { Customer } from '../data/ops/customer'

const mk = (o: Partial<Customer>): Customer => ({
  id: 'c', full_name: 'X', email: null, phone: null, city: null, country: null, seller_name: null,
  external_id: null, source: 'odoo', import_hash: 'h', profile_id: null, meta: {}, active: true,
  created_at: 'T0', updated_at: 'T0', ...o,
})
const SAMPLE: Customer[] = [
  mk({ id: 'c1', full_name: 'Dra. Ana López', email: 'ana@clinica.mx', phone: '6671234567', city: 'Culiacán', country: 'México', seller_name: 'Roberto Ibarra', profile_id: 'p1' }),
  mk({ id: 'c2', full_name: 'Dr. Beto Ruiz', city: 'CDMX', country: 'México', seller_name: 'Alejandra Cazarez' }),
]

vi.mock('../data/hooks/useCustomers', async (importActual) => {
  const actual = await importActual<typeof import('../data/hooks/useCustomers')>()
  return { ...actual, useCustomers: () => ({ data: SAMPLE, loading: false, error: null, reload: async () => {} }) }
})

import { Clientes } from './Clientes'

afterEach(cleanup)

describe('<Clientes> directorio comercial', () => {
  it('renderiza los customers y el conteo', () => {
    renderWithRole(<Clientes />)
    expect(screen.getByText('Dra. Ana López')).toBeTruthy()
    expect(screen.getByText('Dr. Beto Ruiz')).toBeTruthy()
    expect(screen.getByText(/2 cliente/)).toBeTruthy()
  })
  it('búsqueda filtra en vivo (por vendedor)', () => {
    renderWithRole(<Clientes />)
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), { target: { value: 'cazarez' } })
    expect(screen.queryByText('Dra. Ana López')).toBeNull()
    expect(screen.getByText('Dr. Beto Ruiz')).toBeTruthy()
  })
  it('cero resultados muestra el aviso', () => {
    renderWithRole(<Clientes />)
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), { target: { value: 'zzz' } })
    expect(screen.getByText(/Ningún cliente coincide/)).toBeTruthy()
  })
  it('abrir un cliente muestra su detalle y estado de portal', () => {
    renderWithRole(<Clientes />)
    fireEvent.click(screen.getByText('Dra. Ana López'))
    expect(screen.getByText('ana@clinica.mx')).toBeTruthy()
    expect(screen.getAllByText('Con acceso al portal').length).toBeGreaterThan(0)
  })
  it('customer sin portal se marca "Sin acceso al portal"', () => {
    renderWithRole(<Clientes />)
    fireEvent.click(screen.getByText('Dr. Beto Ruiz'))
    expect(screen.getAllByText('Sin acceso al portal').length).toBeGreaterThan(0)
  })
})

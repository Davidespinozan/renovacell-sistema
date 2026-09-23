// @vitest-environment jsdom
// Admin "Doctores" = directorio comercial (customers), población completa (scope all).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import type { Customer } from '../../data/ops/customer'

const mk = (o: Partial<Customer>): Customer => ({
  id: 'c', full_name: 'X', email: null, phone: null, city: null, country: null, seller_name: null,
  external_id: null, source: 'odoo', import_hash: 'h', profile_id: null, meta: {}, active: true,
  created_at: 'T0', updated_at: 'T0', ...o,
})
const SAMPLE: Customer[] = [
  mk({ id: 'c1', full_name: 'Dra. Ana', seller_name: 'Roberto', profile_id: 'p1' }),
  mk({ id: 'c2', full_name: 'Dr. Beto', seller_name: 'Alejandra' }),
]

vi.mock('../../data/hooks/useCustomers', async (importActual) => {
  const actual = await importActual<typeof import('../../data/hooks/useCustomers')>()
  return { ...actual, useCustomers: () => ({ data: SAMPLE, loading: false, error: null, reload: async () => {} }) }
})

import { DoctoresDirectorio } from './DoctoresDirectorio'

afterEach(cleanup)

describe('<DoctoresDirectorio> (admin)', () => {
  it('muestra la población completa de customers con título Doctores y badge de portal', () => {
    renderWithRole(<DoctoresDirectorio />)
    expect(screen.getByText(/Doctores · Directorio comercial/)).toBeTruthy()
    expect(screen.getByText('Dra. Ana')).toBeTruthy()
    expect(screen.getByText('Dr. Beto')).toBeTruthy()
    expect(screen.getByText(/2 · 1 con portal/)).toBeTruthy()
  })
})

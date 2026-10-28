// @vitest-environment jsdom
// Jefe de ventas · Metas y comisiones con los datos del servidor (comisiones_equipo): mismo cálculo, solo lectura
// (sin editar metas ni tasas); y el módulo se suma al menú con la capacidad 'jefe_ventas'.
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { Comisiones } from './Comisiones'
import { capabilityModules, CAPABILITIES } from '../../app/roles'
import type { DatosComisiones } from '../../data/ops/comisionesEquipo'
import { esteMes } from '../../data/periodo'

beforeEach(cleanup)

const hoy = esteMes().desde! + 'T18:00:00Z'
const DATOS: DatosComisiones = {
  vendedores: [{ id: 'r1', email: 'roberto@x', name: 'Roberto Ibarra' }, { id: 'a1', email: 'alejandra@x', name: 'Alejandra Carazarez' }],
  pedidos: [
    { id: 'o1', status: 'delivered', created_at: hoy, total: 10000, shipping_meta: { seller_profile_id: 'r1' }, items: [{ product_id: 'p1', qty: 2, unit_price: 5000, linea: 'prof' }] },
    { id: 'o2', status: 'delivered', created_at: hoy, total: 2000, shipping_meta: { seller_profile_id: 'a1' }, items: [{ product_id: 'p2', qty: 1, unit_price: 2000, linea: 'cosm' }] },
  ] as never,
  asientos: [{ order_id: 'o1', direction: 'in', amount: 10000, value_date: esteMes().desde! }],
  metas: [{ seller: '__default__', target: 50000, commission_rate: 0.05 }, { seller: '__rate_prof__', target: 0, commission_rate: 0.06 }, { seller: '__rate_cosm__', target: 0, commission_rate: 0.04 }, { seller: 'roberto@x', target: 20000, commission_rate: 0.05 }],
  puede_editar: false,
}

describe('Metas y comisiones · jefe de ventas', () => {
  it('muestra a todo el equipo con lo vendido, lo cobrado, la meta y la comisión, sin poder editar', async () => {
    render(<Comisiones leer={async () => ({ ok: true as const, data: DATOS })} />)
    await waitFor(() => expect(screen.getByTestId('comisiones-solo-lectura')).toBeInTheDocument())
    expect(screen.getAllByText('Roberto Ibarra').length).toBeGreaterThan(0)
    expect(screen.getByText('Alejandra Carazarez')).toBeInTheDocument()
    expect(screen.getByTestId('tasa-prof')).toHaveTextContent('Professional: 6.0%')
    expect(screen.getByText(/^\$20,000(\.00)?$/)).toBeInTheDocument()            // meta de Roberto, como texto
    expect(screen.queryByDisplayValue('20000')).toBeNull()                // no hay campo para editarla
    expect(screen.queryByTitle(/Editar la tasa/)).toBeNull()
    expect(screen.getAllByText(/^\$600(\.00)?$/).length).toBeGreaterThan(0)      // 10,000 × 6 % (Professional)
  })
  it('si el servidor lo niega, lo dice', async () => {
    render(<Comisiones leer={async () => ({ ok: false as const, error: 'Metas y comisiones son de Dirección y del jefe de ventas.' })} />)
    await waitFor(() => expect(screen.getByTestId('comisiones-error')).toHaveTextContent('jefe de ventas'))
  })
  it('la capacidad "Jefe de ventas" suma el módulo al menú del vendedor', () => {
    expect(CAPABILITIES.find((c) => c.key === 'jefe_ventas')?.label).toBe('Jefe de ventas')
    expect(capabilityModules(['jefe_ventas']).map((m) => m.key)).toEqual(['av_comisiones'])
  })
})

// @vitest-environment jsdom
// VENTAS DEL EQUIPO · el jefe de ventas ve las ventas de todos (de ventas_equipo, no del RLS del vendedor), con nombre de
// vendedor y filtro; sin acciones de Dirección. Solo él (y Dirección) lo tienen en el menú.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { aVentasEquipo } from './ventasEquipo'
import { capabilityModules } from '../../app/roles'
import mig from '../../../../../supabase/migrations/20270407920000_ventas_equipo_jefe.sql?raw'

const datos = aVentasEquipo({
  vendedores: [{ id: 'u-ale', email: 'ale@x', name: 'Alejandra' }, { id: 'u-rob', email: 'rob@x', name: 'Roberto' }],
  orders: [
    { id: 'o1', external_ref: 'S1', status: 'paid', total: 500, created_at: '2026-11-24T18:00:00Z', shipping_meta: { seller_profile_id: 'u-ale', placed_by: 'Alejandra (Ventas)', customer: { name: 'Dra. Uno' } }, items: [],
      seguimiento: { empacado_at: '2026-11-24T22:04:43Z', salio_at: '2026-11-24T22:05:43Z', entregado_at: '2026-11-24T22:35:09Z', despacho_por: 'Alberto Gutiérrez', chofer: 'Manuel Octavio', recibio: 'Melyna', con_foto: true } },
    { id: 'o2', external_ref: 'S2', status: 'paid', total: 900, created_at: '2026-11-24T19:00:00Z', shipping_meta: { seller_profile_id: 'u-rob', placed_by: 'Roberto (Ventas)', customer: { name: 'Dr. Dos' } }, items: [], seguimiento: {} },
  ],
  money: [{ order_id: 'o1', estado_pago: 'paid', total: 500, cobrado_neto: 500, saldo: 0 }],
})
vi.mock('../../data/ops/ventasEquipo', async (orig) => ({ ...(await orig<object>()), useVentasEquipo: () => ({ ...datos, cargando: false, error: null, recargar: () => {} }) }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'pos', user: { name: 'Roberto' } }), useRoleOpcional: () => ({ role: 'pos' }) }))
import { VentasEquipo } from '../../screens/sales/VentasEquipo'

// La pantalla abre en «Hoy» (27 nov 2026); estas ventas de prueba son de otras fechas: se pasa a «Todo», como haría la persona.
const verTodo = () => fireEvent.click(screen.getByTestId('vd-periodo-todo'))

describe('Ventas del equipo (jefe de ventas)', () => {
  it('ve las ventas de los dos vendedores con su nombre y puede filtrar por vendedor', () => {
    render(<VentasEquipo />); verTodo()
    expect(screen.getByText('S1')).toBeTruthy(); expect(screen.getByText('S2')).toBeTruthy()
    expect(screen.getAllByText('Alejandra').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByTestId('ventas-filtro-vendedor'), { target: { value: 'ale@x' } })
    expect(screen.queryByText('S2')).toBeNull(); expect(screen.getByText('S1')).toBeTruthy()
  })
  it('SEGUIMIENTO: cuándo salió del almacén y cuándo se entregó, con chofer y quién recibió; filtra por etapa', () => {
    render(<VentasEquipo />); verTodo()
    const celdas = screen.getAllByTestId('venta-seguimiento').map((c) => c.textContent)
    expect(celdas.some((t) => /Entregado 24 nov/.test(t ?? ''))).toBe(true)
    expect(celdas).toContain('Aún en almacén')
    fireEvent.change(screen.getByTestId('ventas-filtro-seguimiento'), { target: { value: 'almacen' } })
    expect(screen.queryByText('S1')).toBeNull(); expect(screen.getByText('S2')).toBeTruthy()
    fireEvent.change(screen.getByTestId('ventas-filtro-seguimiento'), { target: { value: 'todos' } })
    fireEvent.click(screen.getByText('S1'))
    const det = screen.getByTestId('venta-detalle-seguimiento').textContent ?? ''
    expect(det).toMatch(/Salió del almacén: 24 nov/); expect(det).toMatch(/despachó Alberto Gutiérrez/); expect(det).toMatch(/chofer Manuel Octavio/)
    expect(det).toMatch(/recibió Melyna · con foto de evidencia/)
  })
  it('el detalle es solo consulta: sin cancelar ni devolver', () => {
    render(<VentasEquipo />); verTodo()
    fireEvent.click(screen.getByText('S1'))
    expect(screen.queryByText('Cancelar pedido')).toBeNull()
    expect(screen.queryByText(/Devolver \/ Corregir/)).toBeNull()
  })
  it('solo la capacidad jefe_ventas trae la pantalla; el servidor exige _jefe_ventas y no toca el RLS de orders', () => {
    expect(capabilityModules(['jefe_ventas']).map((m) => m.key)).toContain('ventas_equipo')
    expect(capabilityModules(['conversaciones', 'eventos']).map((m) => m.key)).not.toContain('ventas_equipo')
    expect(mig).toMatch(/not public\._jefe_ventas\(\)/)
    expect(mig).not.toMatch(/create policy|alter policy/i)
    expect(mig).toMatch(/revoke all on function public\.ventas_equipo\(integer\) from public, anon/)
  })
})

describe('Ventas · abre en «Hoy»', () => {
  it('al entrar muestra solo lo de hoy; «Todo» trae las ventas de otras fechas', () => {
    render(<VentasEquipo />)
    expect(screen.getByTestId('vd-periodo-hoy').getAttribute('aria-pressed')).toBe('true')
    const antes = screen.queryAllByRole('row').length
    verTodo()
    expect(screen.getByTestId('vd-periodo-todo').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryAllByRole('row').length).toBeGreaterThan(antes)
  })
})

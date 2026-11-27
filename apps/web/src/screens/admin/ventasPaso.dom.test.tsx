// @vitest-environment jsdom
// VENTAS ABIERTA POR PASO (27 nov 2026): las cifras «Pedidos en curso» del Inicio de Dirección abren Ventas en «Todo» y
// ya filtrada por ese paso. «En almacén» junta por preparar y preparado, igual que la cifra que se tocó.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ orders: [] as unknown[] }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'admin', user: { name: 'Dirección', email: 'd@x' }, setScreen: vi.fn() }), useRoleOpcional: () => ({ role: 'admin' }) }))
vi.mock('../../data/hooks/useOrders', async (orig) => ({ ...(await orig<object>()), useAllOrders: () => ({ data: h.orders, loading: false }) }))
vi.mock('../../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: {}, loading: false }), usePaymentEntries: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useDoctors', () => ({ useDoctors: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useTeam', () => ({ useTeam: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useFinanzas', () => ({ useRefunds: () => ({ data: [], refundedByOrder: {}, returnedByItem: {}, autorizarReembolso: vi.fn() }) }))
vi.mock('../../data/ops/seguimientoVenta', async (orig) => ({ ...(await orig<object>()), useSeguimiento: () => ({}) }))
import { VentasDetalle } from './VentasDetalle'
import { pedirFiltro, tomarFiltro } from '../../data/store/filtroInicial'

const o = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, external_ref: 'S' + id, status, payment_status: 'paid', payment_method: 'transfer', total: 100, created_at: '2026-11-20T18:00:00Z', items: [], doctor_id: null, shipping_meta: { customer: { name: 'Cliente ' + id } }, ...extra })
const folios = () => ['S1', 'S2', 'S3', 'S4'].filter((f) => screen.queryByText(f))

beforeEach(() => {
  cleanup(); tomarFiltro('av_ventas')
  h.orders = [o('1', 'pending_payment', { payment_status: 'pending' }), o('2', 'paid'), o('3', 'packed'), o('4', 'shipped')]
})

describe('<VentasDetalle> · llegada por paso', () => {
  it('«En almacén» abre en Todo y deja solo por preparar y preparado', () => {
    pedirFiltro('av_ventas', 'paso:en_almacen')
    render(<VentasDetalle />)
    expect(screen.getByTestId('vd-periodo-todo').getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByTestId('ventas-filtro-seguimiento') as HTMLSelectElement).value).toBe('en_almacen')
    expect(folios()).toEqual(['S2', 'S3'])
  })
  it('«Por confirmar» y «En camino» filtran a su paso', () => {
    pedirFiltro('av_ventas', 'paso:por_confirmar')
    const a = render(<VentasDetalle />)
    expect(folios()).toEqual(['S1'])
    a.unmount()
    pedirFiltro('av_ventas', 'paso:salio')
    render(<VentasDetalle />)
    expect(folios()).toEqual(['S4'])
  })
  it('el filtro se puede quitar: «Todos» vuelve a mostrar todo', () => {
    pedirFiltro('av_ventas', 'paso:en_almacen')
    render(<VentasDetalle />)
    fireEvent.change(screen.getByTestId('ventas-filtro-seguimiento'), { target: { value: 'todos' } })
    expect(folios()).toEqual(['S1', 'S2', 'S3', 'S4'])
  })
  it('con la pantalla ya abierta, tocar otra cifra cambia el filtro', () => {
    render(<VentasDetalle />)
    act(() => { pedirFiltro('av_ventas', 'paso:salio') })
    expect(folios()).toEqual(['S4'])
  })
  it('entrando por el menú abre en Hoy y sin filtro de paso', () => {
    render(<VentasDetalle />)
    expect(screen.getByTestId('vd-periodo-hoy').getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByTestId('ventas-filtro-seguimiento') as HTMLSelectElement).value).toBe('todos')
  })
})

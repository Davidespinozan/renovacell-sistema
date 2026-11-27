// @vitest-environment jsdom
// VENTAS ABIERTA POR PASO (27 nov 2026): las cifras «Pedidos en curso» del Inicio de Dirección abren Ventas en «Todo» y
// ya filtrada por ese paso. «En almacén» junta por preparar y preparado, igual que la cifra que se tocó.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ orders: [] as unknown[], ancho: false, byOrder: {} as Record<string, unknown> }))
vi.mock('../../app/useAnchoMinimo', () => ({ useAnchoMinimo: () => h.ancho }))   // computadora (true) o celular (false)
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'admin', user: { name: 'Dirección', email: 'd@x' }, setScreen: vi.fn() }), useRoleOpcional: () => ({ role: 'admin' }) }))
vi.mock('../../data/hooks/useOrders', async (orig) => ({ ...(await orig<object>()), useAllOrders: () => ({ data: h.orders, loading: false }) }))
vi.mock('../../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: h.byOrder, loading: false }), usePaymentEntries: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useDoctors', () => ({ useDoctors: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useTeam', () => ({ useTeam: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useFinanzas', () => ({ useRefunds: () => ({ data: [], refundedByOrder: () => ({}), returnedByItem: () => ({}), autorizarReembolso: vi.fn() }) }))
vi.mock('../../data/ops/seguimientoVenta', async (orig) => ({ ...(await orig<object>()), useSeguimiento: () => ({}) }))
import { VentasDetalle } from './VentasDetalle'
import { pedirFiltro, tomarFiltro } from '../../data/store/filtroInicial'

const o = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, external_ref: 'S' + id, status, payment_status: 'paid', payment_method: 'transfer', total: 100, created_at: '2026-11-20T18:00:00Z', items: [], doctor_id: null, shipping_meta: { customer: { name: 'Cliente ' + id } }, ...extra })
const folios = () => ['S1', 'S2', 'S3', 'S4'].filter((f) => screen.queryByText(f))

beforeEach(() => {
  cleanup(); tomarFiltro('av_ventas'); h.ancho = false; h.byOrder = {}; document.body.classList.remove('rc-acoplado')
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

// RESUMEN, «MÁS FILTROS» Y VENTA AL LADO (27 nov 2026): tres cifras arriba, los filtros detrás de un botón y, en
// computadora, la venta elegida abierta junto a la lista. Las mismas cifras y los mismos filtros de antes.
const verTodo = () => fireEvent.click(screen.getByTestId('vd-periodo-todo'))
describe('<VentasDetalle> · resumen del periodo', () => {
  it('vendido, cobrado y por cobrar; lo demás (ticket, canales) sigue a la vista en una línea', () => {
    h.byOrder = { '2': { cobrado_neto: 100, saldo: 0, estado_pago: 'paid' }, '3': { cobrado_neto: 40, saldo: 60, estado_pago: 'parcial' } }
    render(<VentasDetalle />); verTodo()
    expect(screen.getByTestId('vd-vendido')).toHaveTextContent('$300')          // S2, S3 y S4 (el que espera pago no es venta todavía)
    expect(screen.getByTestId('vd-cobrado')).toHaveTextContent('$240')          // 100 + 40 + S4 pagado
    expect(screen.getByTestId('vd-por-cobrar')).toHaveTextContent('$160')       // S1 completo + saldo de S3
    expect(screen.getByTestId('vd-resumen')).toHaveTextContent('Por cobrar · 2 pedidos')
    const extra = screen.getByTestId('vd-resumen-extra')
    for (const t of ['Ticket promedio', 'Vendedores', 'Caja', 'Portal']) expect(extra).toHaveTextContent(t)
  })
  it('un pedido cancelado no cuenta como por cobrar', () => {
    h.orders = [o('1', 'cancelled', { payment_status: 'pending' }), o('2', 'paid')]
    render(<VentasDetalle />); verTodo()
    expect(screen.getByTestId('vd-por-cobrar')).toHaveTextContent('$0')
  })
})

describe('<VentasDetalle> · «Más filtros»', () => {
  it('entrando por el menú los filtros están guardados; el botón los abre y dice cuántos hay puestos', () => {
    render(<VentasDetalle />); verTodo()
    const panel = screen.getByTestId('vd-filtros-mas'); const boton = screen.getByTestId('vd-mas-filtros')
    expect(panel.hidden).toBe(true); expect(boton.getAttribute('aria-expanded')).toBe('false'); expect(boton).toHaveTextContent(/^\s*Más filtros$/)
    fireEvent.click(boton)
    expect(panel.hidden).toBe(false)
    fireEvent.change(screen.getByTestId('ventas-filtro-seguimiento'), { target: { value: 'salio' } })
    expect(boton).toHaveTextContent('Más filtros · 1')
    fireEvent.click(boton)                                                       // cerrarlo no quita el filtro
    expect(panel.hidden).toBe(true); expect(folios()).toEqual(['S4']); expect(boton).toHaveTextContent('Más filtros · 1')
  })
  it('llegando desde una cifra de Inicio se abren solos, para que se vea por qué viene filtrada', () => {
    pedirFiltro('av_ventas', 'paso:en_almacen')
    render(<VentasDetalle />)
    expect(screen.getByTestId('vd-filtros-mas').hidden).toBe(false)
    expect(screen.getByTestId('vd-mas-filtros')).toHaveTextContent('Más filtros · 1')
  })
})

describe('<VentasDetalle> · la venta se abre al lado (computadora)', () => {
  it('queda junto a la lista, marca su renglón y se pasa a otra sin cerrar', () => {
    h.ancho = true
    render(<VentasDetalle />); verTodo()
    fireEvent.click(screen.getByText('S2'))
    const det = () => screen.getByTestId('venta-detalle')
    expect(det().className).toContain('overlay--acoplado')
    expect(document.body.classList.contains('rc-acoplado')).toBe(true)          // la lista se recorre para dejarle lugar
    expect(det()).toHaveTextContent('Cliente 2')
    expect(screen.getAllByRole('row').find((r) => r.getAttribute('aria-selected') === 'true')).toHaveTextContent('S2')
    fireEvent.click(screen.getByText('S4'))                                      // otra venta, sin cerrar la primera
    expect(det()).toHaveTextContent('Cliente 4'); expect(det()).not.toHaveTextContent('Cliente 2')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('venta-detalle')).toBeNull()
    expect(document.body.classList.contains('rc-acoplado')).toBe(false)
  })
  it('en el celular sigue abriendo su ventana, sin recorrer nada', () => {
    render(<VentasDetalle />); verTodo()
    fireEvent.click(screen.getByText('S2'))
    expect(screen.getByTestId('venta-detalle').className).toBe('overlay')
    expect(document.body.classList.contains('rc-acoplado')).toBe(false)
  })
})

// @vitest-environment jsdom
// PESTAÑAS CON SU NÚMERO (27 nov 2026): «Pedidos» dice cuántos hay en cada pestaña y no abre en una de trabajo vacía.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ orders: [] as unknown[], envios: [] as unknown[] }))
vi.mock('../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: h.orders }) }))
vi.mock('../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: {} }) }))
vi.mock('../data/hooks/useShipments', () => ({ useShipments: () => ({ data: h.envios }) }))
vi.mock('../data/ops/usoPantallas', () => ({ registrarUso: vi.fn() }))
import { Pestanas, pedirPestana } from './Pestanas'

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const o = (id: string, status: string) => ({ id, status, payment_status: 'paid', created_at: `${HOY}T10:00:00Z`, items: [], shipping_meta: {} })
const TABS = [{ key: 'surtido', label: 'Preparar', render: () => <div>pantalla preparar</div> }, { key: 'cola', label: 'Por enviar', render: () => <div>pantalla por enviar</div> }, { key: 'guia', label: 'Guías', render: () => <div>pantalla guías</div> }]

beforeEach(() => { cleanup(); try { localStorage.clear() } catch { /* sin almacenamiento */ } h.orders = [o('a', 'packed'), o('b', 'packed')]; h.envios = [] })

describe('<Pestanas> de Pedidos', () => {
  it('cada pestaña de trabajo dice cuántos tiene; la que está en cero no muestra número', () => {
    render(<Pestanas grupo="g_pedidos" pestanas={TABS} />)
    expect(screen.getByTestId('conteo-cola')).toHaveTextContent('2')
    expect(screen.queryByTestId('conteo-surtido')).toBeNull()
    expect(screen.queryByTestId('conteo-guia')).toBeNull()
  })
  it('sin historial abre en la que tiene trabajo, no en la primera vacía', () => {
    render(<Pestanas grupo="g_pedidos" pestanas={TABS} />)
    expect(screen.getByText('pantalla por enviar')).toBeTruthy()
  })
  it('si la última usada era «Preparar» y quedó vacía, abre en «Por enviar»', () => {
    localStorage.setItem('rc_pestana_g_pedidos', 'surtido')
    render(<Pestanas grupo="g_pedidos" pestanas={TABS} />)
    expect(screen.getByText('pantalla por enviar')).toBeTruthy()
  })
  it('si la última usada era una de consulta (Guías), se respeta', () => {
    localStorage.setItem('rc_pestana_g_pedidos', 'guia')
    render(<Pestanas grupo="g_pedidos" pestanas={TABS} />)
    expect(screen.getByText('pantalla guías')).toBeTruthy()
  })
  it('una pestaña pedida por un aviso manda sobre todo lo demás', () => {
    pedirPestana('g_pedidos', 'surtido')
    render(<Pestanas grupo="g_pedidos" pestanas={TABS} />)
    expect(screen.getByText('pantalla preparar')).toBeTruthy()
  })
  it('los demás grupos siguen igual: sin números y abren en la última usada', () => {
    localStorage.setItem('rc_pestana_g_otro', 'guia')
    render(<Pestanas grupo="g_otro" pestanas={TABS} />)
    expect(screen.getByText('pantalla guías')).toBeTruthy()
    expect(screen.queryByTestId('conteo-cola')).toBeNull()
  })
})

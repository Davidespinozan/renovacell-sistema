// @vitest-environment jsdom
// LO DE SIEMPRE Y MI ASESOR, A LA VISTA (27 nov 2026, «sistema sencillo por rol»): el Inicio del doctor trae dos botones
// grandes — volver a pedir lo de siempre y hablar con su asesor — y el renglón viejo de «último pedido» ya no se repite.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const srv = vi.hoisted(() => ({ setScreen: vi.fn(), verified: true, orders: [] as unknown[], promos: [] as unknown[], seed: vi.fn(), abrirChat: vi.fn() }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'doctor', capabilities: [], setScreen: srv.setScreen, user: { name: 'Dra. Ana Ruiz' }, screen: 'inicio', verified: srv.verified }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useOrders: () => ({ data: srv.orders }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [] }), isPortalProduct: () => true }))
vi.mock('../../data/hooks/usePricing', () => ({ usePricing: () => ({ lists: [], prices: [], priceFor: () => null }) }))
vi.mock('../../data/hooks/useStock', () => ({ useStock: () => new Map() }))
vi.mock('../../data/store/promosStore', () => ({ subscribePromos: () => () => {}, getPromosSnapshot: () => srv.promos }))   // misma referencia siempre (una lista nueva en cada lectura hace girar a React)
vi.mock('../../app/BotonAvisos', () => ({ BotonAvisos: () => null }))
vi.mock('../../data/store/reorderStore', async (orig) => ({ ...(await orig<object>()), seedReorder: srv.seed }))
vi.mock('../../data/store/chatUiStore', async (orig) => ({ ...(await orig<object>()), pedirAbrirChat: srv.abrirChat }))
import { HomeDoctor } from './HomeDoctor'
import { ClienteChat } from '../../data/ops/chat'
import { ClienteCarrito } from '../../data/ops/carrito'

const chatCon = (lectura: Record<string, unknown>) => new ClienteChat(async (_fn, { body }) => (body.action === 'abrir' ? { data: { conversation_id: 'C1' }, error: null } : { data: { conversation_id: 'C1', modo: 'ai', mensajes: [], cart_id: null, ...lectura }, error: null }) as never)
const carrito = new ClienteCarrito(async () => ({ data: null, error: { message: 'no' } }) as never)
const entregado = { id: 'o1', external_ref: 'S100', status: 'delivered', created_at: '2026-11-20T18:00:00Z', items: [{ id: 'i1', product_id: 'p1', qty: 2, unit_price: 500 }, { id: 'i2', product_id: 'p2', qty: 1, unit_price: 900 }] }
const pintar = (lectura: Record<string, unknown> = {}) => render(<HomeDoctor cliente={chatCon(lectura)} clienteCarrito={carrito} flyers={async () => []} promoTarjeta={async () => null} />)

beforeEach(() => { cleanup(); srv.setScreen.mockReset(); srv.seed.mockReset(); srv.abrirChat.mockReset(); srv.verified = true; srv.orders = [] })

describe('Inicio del doctor · lo de siempre y mi asesor', () => {
  it('«Volver a pedir lo de siempre» arma el carrito con su último pedido entregado y lo lleva al catálogo', async () => {
    srv.orders = [entregado]
    pintar()
    fireEvent.click(await screen.findByTestId('doctor-repetir'))
    expect(srv.seed).toHaveBeenCalledWith([{ product_id: 'p1', qty: 2 }, { product_id: 'p2', qty: 1 }])
    expect(srv.setScreen).toHaveBeenCalledWith('catalogo')
    expect(screen.queryByTestId('doctor-ultimo')).toBeNull()          // no se repite con el renglón viejo
  })
  it('sin pedidos entregados no ofrece repetir, pero hablar siempre está', async () => {
    pintar()
    const hablar = await screen.findByTestId('doctor-hablar')
    expect(hablar).toHaveTextContent('Hablar con Renovacell')
    expect(screen.queryByTestId('doctor-repetir')).toBeNull()
    fireEvent.click(hablar)
    expect(srv.abrirChat).toHaveBeenCalledTimes(1)
  })
  it('cuando ya lo atiende una persona, el botón lleva su nombre', async () => {
    pintar({ modo: 'human_active', asesor_nombre: 'Alejandra Félix' })
    await waitFor(() => expect(screen.getByTestId('doctor-hablar')).toHaveTextContent('Hablar con Alejandra'))
  })
  it('quien todavía no está verificado no ve «repetir» (no puede comprar aún)', async () => {
    srv.verified = false; srv.orders = [entregado]
    pintar()
    await screen.findByTestId('doctor-hablar')
    expect(screen.queryByTestId('doctor-repetir')).toBeNull()
  })
})

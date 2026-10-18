// @vitest-environment jsdom
// PROMO-9 · Inicio del doctor: los flyers vigentes (el servidor ya filtró por lista y vigencia) en carrusel; tocar uno lo abre
// a pantalla completa con "Ver en el catálogo"; las promociones vigentes se ven como tarjetas con fotos y precios. Sin
// flyers ni promos, no aparece ninguna sección vacía.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const srv = vi.hoisted(() => ({ setScreen: vi.fn(), promos: [] as Array<{ promocion_id: string; nombre: string; desde: string; hasta: string; listas: null; product_id: string; min_qty: number; precio: number }> }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'doctor', capabilities: [], setScreen: srv.setScreen, user: { name: 'Dra. Ana Ruiz' }, screen: 'inicio', verified: true }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useOrders: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [] }), isPortalProduct: () => true }))
vi.mock('../../data/hooks/usePricing', () => ({ usePricing: () => ({ lists: [], prices: [], priceFor: () => null }) }))
vi.mock('../../data/hooks/useStock', () => ({ useStock: () => new Map() }))
vi.mock('../../data/store/promosStore', () => ({ subscribePromos: () => () => {}, getPromosSnapshot: () => srv.promos }))
vi.mock('../../app/BotonAvisos', () => ({ BotonAvisos: () => null }))
import { HomeDoctor } from './HomeDoctor'
import { ClienteChat } from '../../data/ops/chat'
import { ClienteCarrito } from '../../data/ops/carrito'
import type { Flyer } from '../../data/ops/flyers'
import type { DatosPromoDifusion } from '../../data/ops/promociones'
beforeEach(() => { cleanup(); srv.setScreen.mockReset(); srv.promos = [] })

const chat = new ClienteChat(async (_fn, { body }) => (body.action === 'abrir' ? { data: { conversation_id: 'C1' }, error: null } : { data: { conversation_id: 'C1', modo: 'ai', mensajes: [], cart_id: null }, error: null }) as never)
const carrito = new ClienteCarrito(async () => ({ data: null, error: { message: 'no' } }) as never)
const F1: Flyer = { id: 'F1', titulo: 'Hoy último día · Botox', imagen_url: 'https://cdn.test/f1.jpg', promocion_id: null, product_id: null, desde: '2026-10-18', hasta: null, activo: true, orden: 0, listas: null, estado: 'vigente' }
const F2: Flyer = { ...F1, id: 'F2', titulo: '¡Nuevo lote! Nabota', imagen_url: 'https://cdn.test/f2.jpg' }
const TARJETA: DatosPromoDifusion = { nombre: 'Promo Allergan', vigencia: 'del 16 al 25 de octubre', desde: '2026-10-16', hasta: '2026-10-25', lineas: [], flyer_url: 'https://cdn.test/f1.jpg', productos: [{ product_id: 'B', nombre: 'Botox 100 UI', imagen_url: 'https://cdn.test/botox.png', presentacion: null, precio_normal: 4600, escalones: [{ desde: 1, precio: 4000 }] }] }

describe('PROMO-9 · flyers y promociones en el Inicio del doctor', () => {
  it('sin flyers ni promos no hay secciones vacías', async () => {
    render(<HomeDoctor cliente={chat} clienteCarrito={carrito} flyers={async () => []} promoTarjeta={async () => null} />)
    await screen.findByTestId('home-doctor')
    await waitFor(() => expect(screen.queryByTestId('doctor-flyers')).toBeNull())
    expect(screen.queryByTestId('doctor-promos')).toBeNull(); expect(screen.queryByTestId('rh-sec-flyers')).toBeNull()
  })
  it('los flyers vigentes se ven en carrusel; tocar uno lo abre completo y "Ver en el catálogo" navega', async () => {
    render(<HomeDoctor cliente={chat} clienteCarrito={carrito} flyers={async () => [F1, F2]} promoTarjeta={async () => null} />)
    const c = await screen.findByTestId('doctor-flyers')
    expect(c.querySelectorAll('img')).toHaveLength(2)
    expect(screen.getByTestId('rh-sec-flyers')).toHaveTextContent(/Novedades y promociones/)
    expect(c.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/f1.jpg'); expect(c.querySelector('img')?.getAttribute('alt')).toBe('Hoy último día · Botox')
    fireEvent.click(screen.getByTestId('doctor-flyer-F2'))
    const v = screen.getByTestId('doctor-flyer-visor')
    expect(v.getAttribute('aria-label')).toBe('¡Nuevo lote! Nabota'); expect(v.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/f2.jpg')
    fireEvent.click(screen.getByTestId('doctor-flyer-cerrar')); expect(screen.queryByTestId('doctor-flyer-visor')).toBeNull()
    fireEvent.click(screen.getByTestId('doctor-flyer-F1'))
    fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByTestId('doctor-flyer-visor')).toBeNull()
    fireEvent.click(screen.getByTestId('doctor-flyer-F1'))
    fireEvent.click(screen.getByTestId('doctor-flyer-catalogo'))
    expect(srv.setScreen).toHaveBeenCalledWith('catalogo'); expect(screen.queryByTestId('doctor-flyer-visor')).toBeNull()
  })
  it('las promociones vigentes se ven como tarjetas (una por promoción, con fotos y precios) sin repetir el flyer', async () => {
    srv.promos = [
      { promocion_id: 'P1', nombre: 'Promo Allergan', desde: '2026-10-16', hasta: '2026-10-25', listas: null, product_id: 'B', min_qty: 1, precio: 4000 },
      { promocion_id: 'P1', nombre: 'Promo Allergan', desde: '2026-10-16', hasta: '2026-10-25', listas: null, product_id: 'B', min_qty: 5, precio: 3800 },
    ]
    const tarjeta = vi.fn(async () => TARJETA)
    render(<HomeDoctor cliente={chat} clienteCarrito={carrito} flyers={async () => [F1]} promoTarjeta={tarjeta} />)
    const p = await screen.findByTestId('doctor-promos')
    expect(tarjeta).toHaveBeenCalledTimes(1); expect(tarjeta).toHaveBeenCalledWith('P1')   // una tarjeta por promoción, no por escalón
    expect(p.querySelectorAll('[data-testid="tarjeta-promo"]')).toHaveLength(1)
    expect(p).toHaveTextContent(/Promo Allergan/); expect(p).toHaveTextContent(/\$4,000/)
    expect(p.querySelector('[data-testid="tarjeta-promo-flyer"]')).toBeNull()   // el flyer ya está en el carrusel de arriba
    fireEvent.click(p.querySelector('[data-testid="tarjeta-promo-catalogo"]')!); expect(srv.setScreen).toHaveBeenCalledWith('catalogo')
  })
})

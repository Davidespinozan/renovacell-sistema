// @vitest-environment jsdom
// ENT-3 · Empaque respeta la entrega vendida: la cola va por día de salida (lo atrasado y lo de hoy primero), cada pedido
// muestra lo prometido, el método se preselecciona (DHL → paquetería, chofer → chofer, recoger/mostrador → recoge) y
// "Listo para recoger" marca el pedido sin guía ni chofer.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { EntregaPedido } from '../../data/ops/entrega'

const h = vi.hoisted(() => ({ markShipped: vi.fn(async () => ({ ok: true })), orders: [] as unknown[] }))
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn(), from: vi.fn() }, currentUserId: () => 'U' }))
vi.mock('../../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: h.orders }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ createShipment: vi.fn() }) }))
vi.mock('../../data/ops/cancelacionSolicitud', () => ({ solicitudDe: () => null, useSolicitudesCancelacion: () => [] }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'packing', user: { name: 'Pako' } }) }))
vi.mock('../../data/store/ordersStore', () => ({ markShipped: h.markShipped }))
vi.mock('../../data/store/companyStore', () => ({ currentCompany: () => ({}) }))
vi.mock('../../data/shipping/shipper', () => ({ shipperFromCompany: () => ({ config: { city: 'Culiacán', cp: '80000' } }) }))
vi.mock('./Remision', () => ({ BotonRemision: () => null }))
vi.mock('../../data/ops/empaques', async (orig) => ({ ...(await orig<typeof import('../../data/ops/empaques')>()), listarEmpaques: async () => ({ ok: true, data: [{ id: 'h4', nombre: 'Hielera chica #4', tipo: 'hielera', largo_cm: 20, ancho_cm: 23, alto_cm: 22, peso_kg: 0.5, nota: 'La que se utiliza más', frecuente: true, activo: true, orden: 1 }] }) }))
import { Cola, ordenarPorSalida, metodoSugerido } from './Cola'
beforeEach(() => { cleanup(); h.markShipped.mockClear() })

const ent = (x: Partial<EntregaPedido>): EntregaPedido => ({ opcion: 'foraneo_dhl', tipo: 'foraneo', paqueteria: 'dhl', texto: 'Envío por DHL', flete: 600, flete_regla: 600, local: false, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-22', llega_hasta: '2026-10-26', ...x })
const pedido = (id: string, created: string, entrega: EntregaPedido | null) => ({ id, external_ref: id, status: 'packed', created_at: created, shipping_meta: entrega ? { entrega, customer: { name: 'Dra. X' }, address: { line1: 'Av. 1', cp: '82000' } } : { customer: { name: 'Dra. Y' } }, items: [], total: 0 })

describe('ENT-3 · Empaque', () => {
  it('ordena por día de salida (sin entrega al final) y sugiere el método de lo vendido', () => {
    const a = pedido('A', '2026-10-20T10:00Z', ent({ salida: '2026-10-22' }))
    const b = pedido('B', '2026-10-20T11:00Z', ent({ salida: '2026-10-21' }))
    const c = pedido('C', '2026-10-19T09:00Z', null)
    const d = pedido('D', '2026-10-20T12:00Z', ent({ salida: '2026-10-21' }))
    expect(ordenarPorSalida([a, b, c, d] as never[]).map((o) => (o as { id: string }).id)).toEqual(['B', 'D', 'A', 'C'])
    expect(metodoSugerido(ent({}))).toBe('paqueteria')
    expect(metodoSugerido(ent({ opcion: 'local_chofer', tipo: 'local', paqueteria: 'chofer' }))).toBe('chofer')
    expect(metodoSugerido(ent({ opcion: 'recoge', tipo: 'recoge', paqueteria: null }))).toBe('recoge')
    expect(metodoSugerido(ent({ opcion: 'mostrador', tipo: 'mostrador', paqueteria: null }))).toBe('recoge')
    expect(metodoSugerido(null)).toBe('paqueteria')
  })
  it('la cola muestra lo prometido y "Listo para recoger" marca el pedido sin guía', async () => {
    h.orders = [pedido('S1', '2026-10-20T10:00Z', ent({ opcion: 'recoge', tipo: 'recoge', paqueteria: null, texto: 'Recoger en Sucursal Renovacell', flete: 0, flete_regla: 0, llega_desde: '2026-10-21', llega_hasta: '2026-10-21', recoge: { lugar: 'Sucursal Renovacell', horario: 'L–S' } }))]
    render(<Cola />)
    expect(screen.getByTestId('cola-entrega')).toHaveTextContent(/Recoger en Sucursal Renovacell/)
    expect(screen.getByTestId('cola-entrega')).toHaveTextContent(/Listo para recoger/)
    fireEvent.click(screen.getByText('Asignar envío'))
    expect(screen.getByTestId('asignar-entrega')).toHaveTextContent(/Se vendió como: Recoger en Sucursal Renovacell/)
    expect(screen.getByTestId('metodo-recoge').className).toBe('active')   // preseleccionado
    fireEvent.click(screen.getByTestId('btn-listo-recoger'))
    await waitFor(() => expect(screen.getByText('Listo para recoger')).toBeInTheDocument())
    expect(h.markShipped).toHaveBeenCalledWith('S1', { method: 'recoge', carrier: null, tracking: null })
  })
  it('elegir otro método que el vendido se avisa (el cliente espera lo prometido)', () => {
    h.orders = [pedido('S2', '2026-10-20T10:00Z', ent({}))]
    render(<Cola />)
    fireEvent.click(screen.getByText('Asignar envío'))
    expect(screen.getByTestId('asignar-entrega')).not.toHaveTextContent(/Estás eligiendo otro método/)
    fireEvent.click(screen.getByText('Chofer propio'))
    expect(screen.getByTestId('asignar-entrega')).toHaveTextContent(/Estás eligiendo otro método/)
  })
  it('EMP-1 · elegir un empaque del catálogo llena las medidas (y el peso vacío si se conoce) para cotizar', async () => {
    h.orders = [pedido('S3', '2026-10-20T10:00Z', ent({}))]
    render(<Cola />)
    fireEvent.click(screen.getByText('Asignar envío'))
    const sel = await screen.findByTestId('empaque-select')
    expect(sel).toHaveTextContent(/Hielera chica #4 · 20×23×22 cm · La que se utiliza más/)
    fireEvent.change(sel, { target: { value: 'h4' } })
    expect((screen.getByLabelText('Largo en centímetros') as HTMLInputElement).value).toBe('20')
    expect((screen.getByLabelText('Ancho en centímetros') as HTMLInputElement).value).toBe('23')
    expect((screen.getByLabelText('Alto en centímetros') as HTMLInputElement).value).toBe('22')
    expect((screen.getByLabelText('Peso en kilogramos') as HTMLInputElement).value).toBe('0.5')
  })
})

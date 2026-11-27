// @vitest-environment jsdom
// CHOFER · MENOS PASOS (27 nov 2026): toda la carga de un toque, y el nombre de quien recibe se toca en vez de escribirse.
// Lo de antes sigue: el botón de confirmar por pedido y el de reportar un problema con la carga.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  envios: [] as Array<Record<string, unknown>>,
  confirmLoad: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'driver', user: { name: 'Beto', email: 'chofer@renovacell.mx' }, vistaPrevia: null }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ data: h.envios, reportIncident: vi.fn(async () => ({ ok: true })), confirmLoad: h.confirmLoad }) }))
const pedido = (id: string, folio: string, nombre: string) => ({ id, external_ref: folio, doctor_id: null, payment_status: 'paid', total: 1000, items: [{ product_id: 'p1', qty: 1, unit_price: 1000 }],
  shipping_meta: { customer: { name: nombre, phone: '6671234567' }, address: { line1: 'Av. Obregón 1200', city: 'Culiacán', phone: '6671234567' } } })
vi.mock('../../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: [pedido('o1', 'S101', 'Dra. Ana Morales'), pedido('o2', 'S102', 'Dr. Luis Vega'), pedido('o3', 'S103', 'Dr. Raúl Ruiz')] }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'p1', name: 'Producto' }] }) }))
vi.mock('../../data/hooks/useRastreoRuta', () => ({ useRastreoRuta: () => 'inactivo', usePantallaEncendida: () => false, leerPantallaEncendida: () => false, guardarPantallaEncendida: vi.fn() }))
vi.mock('./MiEfectivo', () => ({ MiEfectivo: () => null }))
vi.mock('./CobroEntrega', () => ({ CobroEntrega: () => null }))
vi.mock('./FirmaEntrega', () => ({ FirmaEntrega: () => <div data-testid="firma" /> }))
import { MisEntregas } from './MisEntregas'

const envio = (id: string, order: string, status: string) => ({ id, order_id: order, driver_id: 'drv-1', status, incident: null, estimated_delivery_at: null, dispatched_by: 'Alberto' })

beforeEach(() => { cleanup(); h.confirmLoad.mockClear(); try { localStorage.clear() } catch { /* sin almacenamiento */ } })

describe('<MisEntregas> · recibir toda la carga', () => {
  it('con varios pedidos despachados, un toque los confirma todos', async () => {
    h.envios = [envio('e1', 'o1', 'despachado'), envio('e2', 'o2', 'despachado'), envio('e3', 'o3', 'out_for_delivery')]
    render(<MisEntregas />)
    const boton = screen.getByTestId('carga-toda-confirmar')
    expect(boton.textContent).toContain('Recibí mi carga (2 pedidos)')
    fireEvent.click(boton)
    await waitFor(() => expect(h.confirmLoad).toHaveBeenCalledTimes(2))
    expect(h.confirmLoad.mock.calls.map((c) => c[2])).toEqual(['S101', 'S102'])
    // lo de antes no se pierde: cada pedido conserva su botón y su reporte de problema
    expect(screen.getAllByText(/Confirmar que recibí mi carga/)).toHaveLength(2)
    expect(screen.getAllByText(/Reportar problema con la carga/)).toHaveLength(2)
  })

  it('con un solo pedido despachado no se duplica el botón: basta el del pedido', () => {
    h.envios = [envio('e1', 'o1', 'despachado'), envio('e3', 'o3', 'out_for_delivery')]
    render(<MisEntregas />)
    expect(screen.queryByTestId('carga-toda')).toBeNull()
    expect(screen.getAllByText(/Confirmar que recibí mi carga/)).toHaveLength(1)
  })
})

describe('<MisEntregas> · quién recibe', () => {
  it('ofrece el nombre del cliente para tocarlo y, al tocarlo, lo llena', () => {
    h.envios = [envio('e3', 'o3', 'out_for_delivery')]
    render(<MisEntregas />)
    const sug = screen.getByTestId('recibe-sugerido')
    expect(sug.textContent).toBe('Recibe Dr. Raúl Ruiz')
    fireEvent.click(sug)
    expect((screen.getByLabelText('Quién recibió') as HTMLInputElement).value).toBe('Dr. Raúl Ruiz')
    expect(screen.queryByTestId('recibe-sugerido')).toBeNull()
  })

  it('se puede seguir escribiendo otro nombre', () => {
    h.envios = [envio('e3', 'o3', 'out_for_delivery')]
    render(<MisEntregas />)
    fireEvent.change(screen.getByLabelText('Quién recibió'), { target: { value: 'Recepción' } })
    expect((screen.getByLabelText('Quién recibió') as HTMLInputElement).value).toBe('Recepción')
    expect(screen.queryByTestId('recibe-sugerido')).toBeNull()
  })
})

// @vitest-environment jsdom
// Asignar a chofer deja el envío "por despachar". Si la carga se le entrega en ese momento, se despacha desde el mismo
// modal (envío despachado y, solo entonces, pedido En camino); si no, queda en el manifiesto. Antes el despacho se
// olvidaba y el chofer veía "Esperando que Almacén te despache" con la carga en la mano.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const srv = vi.hoisted(() => ({ create: vi.fn(), dispatch: vi.fn(), shipped: vi.fn() }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ createShipment: srv.create, dispatchShipment: srv.dispatch }) }))
vi.mock('../../data/store/ordersStore', async (orig) => ({ ...(await orig<typeof import('../../data/store/ordersStore')>()), markShipped: srv.shipped }))
vi.mock('../../data/ops/empaques', () => ({ listarEmpaques: async () => ({ ok: true, data: [] }), medidasTexto: () => '' }))
import { AsignarModal } from './Cola'

const ORDER = { id: 'o1', external_ref: 'S100010', status: 'packed', created_at: '2026-10-28T10:00:00Z', items: [],
  shipping_meta: { customer: { name: 'Dra. Ana Ruiz', phone: '6671234567' }, address: { line1: 'Av. Obregón 1', cp: '80000', city: 'Culiacán', state: 'Sinaloa', phone: '6671234567' },
    entrega: { opcion: 'local', tipo: 'local', paqueteria: 'chofer', texto: 'Entrega local', flete: 0, flete_regla: 0, salida: '2026-10-28', llega_desde: '2026-10-28', llega_hasta: '2026-10-28' } } } as never

beforeEach(() => {
  cleanup(); srv.create.mockReset(); srv.dispatch.mockReset(); srv.shipped.mockReset(); try { localStorage.clear() } catch { /* sin almacenamiento */ }
  srv.create.mockResolvedValue({ ok: true, shipment: { id: 'sh1' } })
})

async function asignar() {
  render(<AsignarModal order={ORDER} onClose={() => {}} />)
  const sel = screen.getAllByRole('combobox').find((s) => s.querySelector('option[value="drv-1"]'))!
  fireEvent.change(sel, { target: { value: 'drv-1' } })
  fireEvent.click(screen.getByTestId('solo-asignar'))   // «Solo asignar: sale después» = el camino de siempre
  await screen.findByText('Chofer asignado')
  expect(srv.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'por_despachar', driver_id: 'drv-1' }))
}

describe('Cola · asignar a chofer y despachar en el mismo paso', () => {
  it('"Ya le entregué la carga" despacha el envío y luego pone el pedido En camino', async () => {
    srv.dispatch.mockResolvedValue({ ok: true }); srv.shipped.mockResolvedValue({ ok: true })
    await asignar()
    fireEvent.click(screen.getByTestId('despachar-ahora'))
    expect(await screen.findByText('Carga despachada')).toBeTruthy()
    expect(srv.dispatch).toHaveBeenCalledWith('sh1', expect.any(String), 'S100010')
    expect(srv.shipped).toHaveBeenCalledWith('o1', expect.objectContaining({ method: 'chofer', driver_id: 'drv-1' }))
  })
  it('si el despacho no quedó, lo dice y el pedido NO pasa a En camino', async () => {
    srv.dispatch.mockResolvedValue({ ok: false, error: 'No tienes permiso para esta operación.', ambiguous: false })
    await asignar()
    fireEvent.click(screen.getByTestId('despachar-ahora'))
    await waitFor(() => expect(screen.getByTestId('despachar-ahora-error')).toHaveTextContent(/NO quedó despachada/))
    expect(srv.shipped).not.toHaveBeenCalled()
    expect(screen.queryByText('Carga despachada')).toBeNull()
  })
  it('"Sale después" no despacha: queda en el manifiesto', async () => {
    await asignar()
    expect(screen.getByRole('button', { name: 'Sale después' })).toBeTruthy()
    expect(srv.dispatch).not.toHaveBeenCalled()
  })
})

// ENTREGAR AL CHOFER EN UN PASO (27 nov 2026): un solo toque asigna y da salida; el chofer ya viene elegido.
describe('Cola · «Entregar al chofer» en un paso', () => {
  const elegir = (id: string) => fireEvent.change(screen.getAllByRole('combobox').find((s) => s.querySelector(`option[value="${id}"]`))!, { target: { value: id } })
  it('asigna, despacha y pone el pedido En camino con un solo toque', async () => {
    srv.dispatch.mockResolvedValue({ ok: true }); srv.shipped.mockResolvedValue({ ok: true })
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: /Entregar al chofer · S100010/ })).toBeTruthy()
    elegir('drv-1')
    fireEvent.click(screen.getByTestId('entregar-chofer'))
    expect(await screen.findByText('Carga despachada')).toBeTruthy()
    expect(srv.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'por_despachar', driver_id: 'drv-1' }))
    expect(srv.dispatch).toHaveBeenCalledWith('sh1', expect.any(String), 'S100010')
    expect(srv.shipped).toHaveBeenCalledWith('o1', expect.objectContaining({ method: 'chofer', driver_id: 'drv-1' }))
  })
  it('si la salida falla, el envío queda asignado y se puede reintentar: nada se pierde', async () => {
    srv.dispatch.mockResolvedValue({ ok: false, error: 'Sin conexión.', ambiguous: false })
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    elegir('drv-1')
    fireEvent.click(screen.getByTestId('entregar-chofer'))
    expect(await screen.findByText('Chofer asignado')).toBeTruthy()
    expect(screen.getByTestId('despachar-ahora-error')).toHaveTextContent(/NO quedó despachada/)
    expect(srv.shipped).not.toHaveBeenCalled()
    expect(screen.getByTestId('despachar-ahora')).toBeTruthy()
  })
  it('si no se pudo asignar, lo dice ahí mismo y no intenta dar salida', async () => {
    srv.create.mockResolvedValue({ ok: false, error: 'Ya hay un envío vivo.', ambiguous: false })
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    elegir('drv-1')
    fireEvent.click(screen.getByTestId('entregar-chofer'))
    await waitFor(() => expect(screen.getByTestId('chofer-error')).toHaveTextContent(/No se asignó el chofer/))
    expect(srv.dispatch).not.toHaveBeenCalled()
  })
  it('sin chofer elegido los botones están apagados y dice qué falta', () => {
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    expect(screen.getByTestId('chofer-pista')).toHaveTextContent('Elige el chofer para continuar.')
    expect((screen.getByTestId('entregar-chofer') as HTMLButtonElement).disabled).toBe(true)
  })
  it('el último chofer que se eligió ya viene elegido la siguiente vez', async () => {
    srv.dispatch.mockResolvedValue({ ok: true }); srv.shipped.mockResolvedValue({ ok: true })
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    elegir('drv-2')
    fireEvent.click(screen.getByTestId('entregar-chofer'))
    await screen.findByText('Carga despachada')
    cleanup()
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    expect((screen.getAllByRole('combobox').find((s) => s.querySelector('option[value="drv-2"]')) as HTMLSelectElement).value).toBe('drv-2')
    expect(screen.getByTestId('chofer-pista')).toHaveTextContent(/Ya viene elegido/)
    expect((screen.getByTestId('entregar-chofer') as HTMLButtonElement).disabled).toBe(false)
  })
})

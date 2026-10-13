// @vitest-environment jsdom
// Guías: la etiqueta de una guía ya generada se puede volver a descargar; una guía recién generada no se muestra como
// "En camino" (el paquete sigue en el local) y se avisa que la guía no incluye recolección.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ envios: [] as unknown[], etiqueta: vi.fn(), anular: vi.fn(), recargaEnvios: vi.fn(), recargaPedidos: vi.fn() }))
vi.mock('../../data/shipping/anularGuia', () => ({ anularGuia: (...a: unknown[]) => h.anular(...a) }))
vi.mock('../../data/store/shipmentsStore', () => ({ reloadShipments: () => h.recargaEnvios() }))
vi.mock('../../data/store/ordersStore', () => ({ reloadOrders: () => h.recargaPedidos() }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ data: h.envios }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: [{ id: 'O-1', external_ref: 'S100001' }, { id: 'O-2', external_ref: 'S100002' }] }) }))
vi.mock('../../data/shipping/provider', () => ({ etiquetaDeGuia: (...a: unknown[]) => h.etiqueta(...a) }))
vi.mock('../../app/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('../../data/hooks/useRastreo', () => ({ useRastreo: () => ({ rastreo: null, cargando: false, actualizar: () => {} }) }))
import { Guias } from './Guias'

const DHL = { id: 'SH-1', order_id: 'O-1', carrier: 'DHL', tracking_number: '8664197986', label_url: null, driver_id: null, status: 'in_transit', estimated_delivery_at: '2026-10-14T17:00:00Z', dispatched_at: null }
const pestana = { location: { href: '' }, close: vi.fn() }

beforeEach(() => { cleanup(); h.envios = [DHL]; h.etiqueta.mockReset(); h.anular.mockReset(); h.recargaEnvios.mockReset(); h.recargaPedidos.mockReset(); pestana.location.href = ''; pestana.close.mockReset(); window.open = vi.fn(() => pestana as unknown as Window) })

describe('Guías', () => {
  it('guía de paquetería recién generada: no dice "En camino" y avisa que no incluye recolección', () => {
    render(<Guias />)
    expect(screen.getByText(/Guía generada · por entregar a paquetería/)).toBeTruthy()
    expect(screen.queryByText('En camino')).toBeNull()
    expect(screen.getByText(/no incluye recolección/)).toBeTruthy()
  })
  it('la etiqueta se vuelve a descargar: pide un enlace nuevo por el pedido y lo abre', async () => {
    h.etiqueta.mockResolvedValue({ url: 'https://storage.test/etiqueta-firmada.pdf', tracking: '8664197986' })
    render(<Guias />)
    fireEvent.click(screen.getByTestId('descargar-etiqueta'))
    await waitFor(() => expect(pestana.location.href).toBe('https://storage.test/etiqueta-firmada.pdf'))
    expect(h.etiqueta).toHaveBeenCalledTimes(1); expect(h.etiqueta).toHaveBeenCalledWith('O-1')
  })
  it('si no se puede obtener: aviso, se cierra la pestaña y no se queda cargando', async () => {
    h.etiqueta.mockResolvedValue(null)
    render(<Guias />)
    fireEvent.click(screen.getByTestId('descargar-etiqueta'))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo obtener la etiqueta')
    expect(pestana.close).toHaveBeenCalled()
    expect((screen.getByTestId('descargar-etiqueta') as HTMLButtonElement).disabled).toBe(false)
  })
  it('chofer propio no ofrece etiqueta; ya despachado o entregado conserva su estatus real', () => {
    h.envios = [{ ...DHL, id: 'SH-2', order_id: 'O-2', tracking_number: null, driver_id: 'D-1', status: 'assigned' }, { ...DHL, id: 'SH-3', status: 'delivered' }, { ...DHL, id: 'SH-4', dispatched_at: '2026-10-13T18:00:00Z' }]
    render(<Guias />)
    expect(screen.getAllByTestId('descargar-etiqueta')).toHaveLength(2)
    expect(screen.getByText('Entregado')).toBeTruthy(); expect(screen.getByText('En camino')).toBeTruthy(); expect(screen.getByText('Asignado a chofer')).toBeTruthy()
  })

  it('anular guía: exige motivo, manda el pedido y el motivo, y recarga envíos y pedidos', async () => {
    h.anular.mockResolvedValue({ ok: true, guia: '8664197986' })
    render(<Guias />)
    fireEvent.click(screen.getByTestId('anular-abrir'))
    const confirmar = screen.getByTestId('anular-confirmar') as HTMLButtonElement
    expect(confirmar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Motivo de la anulación'), { target: { value: '  dirección equivocada ' } })
    fireEvent.click(confirmar)
    await waitFor(() => expect(h.recargaPedidos).toHaveBeenCalled())
    expect(h.anular).toHaveBeenCalledTimes(1)
    expect(h.anular.mock.calls[0].slice(0, 2)).toEqual(['O-1', 'dirección equivocada'])
    expect(h.recargaEnvios).toHaveBeenCalled(); expect(screen.queryByTestId('anular-form')).toBeNull()
  })
  it('anular guía: el rechazo se muestra; si el resultado es desconocido se reintenta con la MISMA operación', async () => {
    h.anular.mockResolvedValueOnce({ ok: false, error: 'No se pudo confirmar', ambiguo: true }).mockResolvedValueOnce({ ok: false, error: 'Primero cancela la recolección', ambiguo: false }).mockResolvedValueOnce({ ok: true, guia: 'x' })
    render(<Guias />)
    fireEvent.click(screen.getByTestId('anular-abrir'))
    fireEvent.change(screen.getByLabelText('Motivo de la anulación'), { target: { value: 'paquete mal medido' } })
    fireEvent.click(screen.getByTestId('anular-confirmar'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/No se pudo confirmar/))
    fireEvent.click(screen.getByTestId('anular-confirmar'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Primero cancela/))
    fireEvent.click(screen.getByTestId('anular-confirmar'))
    await waitFor(() => expect(h.anular).toHaveBeenCalledTimes(3))
    const ops = h.anular.mock.calls.map((c) => c[2])
    expect(ops[1]).toBe(ops[0]); expect(ops[2]).not.toBe(ops[1])
    expect(h.recargaPedidos).toHaveBeenCalledTimes(1)
  })
  it('no se ofrece anular con recolección agendada, ya despachada, entregada o con chofer; una anulada muestra su número tachado', () => {
    h.envios = [
      { ...DHL, id: 'SH-5', pickup_confirmation: 'AME1' }, { ...DHL, id: 'SH-6', dispatched_at: '2026-10-13T18:00:00Z' }, { ...DHL, id: 'SH-7', status: 'delivered' },
      { ...DHL, id: 'SH-8', order_id: 'O-2', tracking_number: null, driver_id: 'D-1', status: 'assigned' },
      { ...DHL, id: 'SH-9', tracking_number: null, status: 'cancelado', provider_meta: { anulada: { tracking: '8664197986', motivo: 'x' } } },
    ]
    render(<Guias />)
    expect(screen.queryByTestId('anular-abrir')).toBeNull()
    expect(screen.getByText('Guía anulada')).toBeTruthy()
  })
})

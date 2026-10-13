// @vitest-environment jsdom
// Guías: la etiqueta de una guía ya generada se puede volver a descargar; una guía recién generada no se muestra como
// "En camino" (el paquete sigue en el local) y se avisa que la guía no incluye recolección.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ envios: [] as unknown[], etiqueta: vi.fn() }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ data: h.envios }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: [{ id: 'O-1', external_ref: 'S100001' }, { id: 'O-2', external_ref: 'S100002' }] }) }))
vi.mock('../../data/shipping/provider', () => ({ etiquetaDeGuia: (...a: unknown[]) => h.etiqueta(...a) }))
vi.mock('../../app/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('../../data/hooks/useRastreo', () => ({ useRastreo: () => ({ rastreo: null, cargando: false, actualizar: () => {} }) }))
import { Guias } from './Guias'

const DHL = { id: 'SH-1', order_id: 'O-1', carrier: 'DHL', tracking_number: '8664197986', label_url: null, driver_id: null, status: 'in_transit', estimated_delivery_at: '2026-10-14T17:00:00Z', dispatched_at: null }
const pestana = { location: { href: '' }, close: vi.fn() }

beforeEach(() => { cleanup(); h.envios = [DHL]; h.etiqueta.mockReset(); pestana.location.href = ''; pestana.close.mockReset(); window.open = vi.fn(() => pestana as unknown as Window) })

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
})

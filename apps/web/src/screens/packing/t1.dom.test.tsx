// @vitest-environment jsdom
// T1 · (28 nov 2026, dueño) T1 NO está conectado por API: su guía siempre se captura a mano. DHL cotiza y genera, y también
// acepta registrar a mano una guía hecha en su portal (Alberto).
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const srv = vi.hoisted(() => ({ quote: vi.fn(), create: vi.fn(), crearEnvio: vi.fn(async (x: unknown) => ({ ok: true, shipment: { ...(x as object), id: 's1' } })) }))
vi.mock('../../data/shipping/provider', async (orig) => ({ ...(await orig<typeof import('../../data/shipping/provider')>()), quoteShipment: srv.quote, createShipmentReal: srv.create }))
vi.mock('../../data/shipping/shipper', () => ({ shipperFromCompany: () => ({ config: { name: 'Renovacell', addressLine1: 'Blvd 1', city: 'Culiacán', state: 'Sin', cp: '80000', country: 'MX', phone: '6671112233', email: 'a@b.mx' } }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ createShipment: srv.crearEnvio }) }))
vi.mock('../../data/ops/empaques', () => ({ listarEmpaques: async () => ({ ok: true, data: [] }), medidasTexto: () => '' }))
vi.mock('../../data/store/driversStore', () => ({ getDrivers: () => [] }))
import { AsignarModal, mensajeProveedor } from './Cola'
beforeEach(() => { cleanup(); srv.quote.mockReset(); srv.create.mockReset(); srv.crearEnvio.mockClear() })

const ORDER = { id: 'o1', external_ref: 'S100002', status: 'packed', created_at: '2026-10-20T10:00:00Z', items: [],
  shipping_meta: { customer: { name: 'Dra. Ana Ruiz', phone: '5512345678' }, address: { line1: 'Av. Reforma 123', colonia: 'Centro', cp: '06600', city: 'Ciudad de México', state: 'CDMX', phone: '5512345678' },
    entrega: { opcion: 'foraneo_t1', tipo: 'foraneo', paqueteria: 't1', texto: 'Envío por T1', flete: 0, flete_regla: 0, salida: '2026-10-21', llega_desde: '2026-10-23', llega_hasta: '2026-10-26' } } } as never

describe('T1 · siempre guía manual', () => {
  it('lo vendido sugiere T1 y se abre directo la captura a mano, sin cotizar', async () => {
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    expect(screen.getByTestId('proveedor-t1').className).toBe('active')
    expect(screen.getByTestId('proveedor-t1')).toHaveTextContent('T1 Envíos (manual)')
    expect(screen.getByTestId('estafeta-manual')).toHaveTextContent(/portal de T1 Envíos/)
    expect(screen.queryByRole('button', { name: /Cotizar envío/ })).toBeNull()
    fireEvent.change(screen.getByTestId('t1-paqueteria'), { target: { value: 'FedEx' } })
    fireEvent.change(screen.getByTestId('estafeta-guia'), { target: { value: 'fx 12345' } })
    fireEvent.click(screen.getByTestId('estafeta-guardar'))
    await waitFor(() => expect(srv.crearEnvio).toHaveBeenCalledTimes(1))
    expect(srv.crearEnvio.mock.calls[0][0]).toMatchObject({ provider: 't1', carrier: 'FedEx (T1)', tracking_number: 'FX12345', provider_meta: { manual: true, fuera_del_sistema: true } })
    expect(srv.quote).not.toHaveBeenCalled()
  })
  it('DHL cotiza; con «Regístrala a mano» captura la guía hecha en su portal', async () => {
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('proveedor-dhl'))
    expect(screen.getByTestId('proveedor-guia')).toHaveTextContent(/Se vendió con T1; estás generando con otra paquetería/)
    expect(screen.getByRole('button', { name: /Cotizar envío/ })).toBeTruthy()
    fireEvent.click(screen.getByTestId('guia-a-mano'))
    fireEvent.change(screen.getByTestId('estafeta-guia'), { target: { value: '1234567890' } })
    fireEvent.click(screen.getByTestId('estafeta-guardar'))
    await waitFor(() => expect(srv.crearEnvio).toHaveBeenCalledTimes(1))
    expect(srv.crearEnvio.mock.calls[0][0]).toMatchObject({ provider: 'dhl', carrier: 'DHL', tracking_number: '1234567890' })
  })
  it('los mensajes del servidor siguen en palabras', () => {
    expect(mensajeProveedor('shipping_not_configured')).toMatch(/DHL no está configurado/); expect(mensajeProveedor('otro')).toBe('otro')
  })
})

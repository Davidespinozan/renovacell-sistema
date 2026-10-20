// @vitest-environment jsdom
// T1 · en Empaque, "Generar la guía con" elige DHL directo o T1 Envíos; lo vendido sugiere; cotizar y generar mandan el
// proveedor al servidor; si T1 no tiene llaves, el mensaje lo dice en palabras.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const srv = vi.hoisted(() => ({ quote: vi.fn(), create: vi.fn() }))
vi.mock('../../data/shipping/provider', async (orig) => ({ ...(await orig<typeof import('../../data/shipping/provider')>()), quoteShipment: srv.quote, createShipmentReal: srv.create }))
vi.mock('../../data/shipping/shipper', () => ({ shipperFromCompany: () => ({ config: { name: 'Renovacell', addressLine1: 'Blvd 1', city: 'Culiacán', state: 'Sin', cp: '80000', country: 'MX', phone: '6671112233', email: 'a@b.mx' } }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ createShipment: vi.fn(async () => ({ ok: true })) }) }))
vi.mock('../../data/ops/empaques', () => ({ listarEmpaques: async () => ({ ok: true, data: [] }), medidasTexto: () => '' }))
vi.mock('../../data/store/driversStore', () => ({ getDrivers: () => [] }))
import { AsignarModal, mensajeProveedor } from './Cola'
beforeEach(() => { cleanup(); srv.quote.mockReset(); srv.create.mockReset() })

const ORDER = { id: 'o1', external_ref: 'S100002', status: 'packed', created_at: '2026-10-20T10:00:00Z', items: [],
  shipping_meta: { customer: { name: 'Dra. Ana Ruiz', phone: '5512345678' }, address: { line1: 'Av. Reforma 123', colonia: 'Centro', cp: '06600', city: 'Ciudad de México', state: 'CDMX', phone: '5512345678' },
    entrega: { opcion: 'foraneo_t1', tipo: 'foraneo', paqueteria: 't1', texto: 'Envío por T1', flete: 0, flete_regla: 0, salida: '2026-10-21', llega_desde: '2026-10-23', llega_hasta: '2026-10-26' } } } as never

describe('T1 · proveedor de la guía en Empaque', () => {
  it('lo vendido sugiere T1; cotizar manda provider t1; cambiar a DHL avisa que se vendió con otro', async () => {
    srv.quote.mockResolvedValue([{ id: 'FEDEX|GROUND', serviceCode: 'FEDEX|GROUND', carrier: 'FedEx', service: 'Terrestre', amount: 140, currency: 'MXN', etaDays: 4 }])
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    expect(screen.getByTestId('proveedor-t1').className).toBe('active')
    for (const [l, v] of [['Peso en kilogramos', '1'], ['Largo en centímetros', '30'], ['Ancho en centímetros', '20'], ['Alto en centímetros', '10']]) fireEvent.change(screen.getByLabelText(l), { target: { value: v } })
    fireEvent.click(screen.getByRole('button', { name: /Cotizar envío/ }))
    await waitFor(() => expect(srv.quote).toHaveBeenCalledTimes(1))
    expect(srv.quote.mock.calls[0][4]).toBe('t1')
    expect(await screen.findByText(/FedEx/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('proveedor-dhl'))
    expect(screen.getByTestId('proveedor-guia')).toHaveTextContent(/Se vendió con T1 Envíos; estás generando con otro proveedor/)
    expect(screen.queryByText(/FedEx/)).toBeNull()   // al cambiar de proveedor se recotiza
  })
  it('T1 sin llaves: mensaje en palabras, nada de guía mock', async () => {
    srv.quote.mockRejectedValue(new Error('t1_not_configured'))
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    for (const [l, v] of [['Peso en kilogramos', '1'], ['Largo en centímetros', '30'], ['Ancho en centímetros', '20'], ['Alto en centímetros', '10']]) fireEvent.change(screen.getByLabelText(l), { target: { value: v } })
    fireEvent.click(screen.getByRole('button', { name: /Cotizar envío/ }))
    expect(await screen.findByText(/T1 Envíos no está configurado en el servidor/)).toBeTruthy()
    expect(mensajeProveedor('shipping_not_configured')).toMatch(/DHL no está configurado/); expect(mensajeProveedor('otro')).toBe('otro')
  })
  it('una guía de sandbox se marca como ambiente de pruebas, nunca como envío real', async () => {
    srv.quote.mockResolvedValue([{ id: 'FEDEX|GROUND', serviceCode: 'FEDEX|GROUND', carrier: 'FedEx', service: 'Terrestre', amount: 140, currency: 'MXN', etaDays: 4 }])
    srv.create.mockResolvedValue({ label: { provider: 't1', ambiente: 'test', carrier: 'FedEx', service: 'Terrestre', serviceCode: 'FEDEX|GROUND', tracking: 'SBX123', labelUrl: 'https://x/l.pdf', amount: 140, etaDays: 4, estimatedDeliveryAt: '2026-10-25T00:00:00Z' } })
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    for (const [l, v] of [['Peso en kilogramos', '1'], ['Largo en centímetros', '30'], ['Ancho en centímetros', '20'], ['Alto en centímetros', '10']]) fireEvent.change(screen.getByLabelText(l), { target: { value: v } })
    fireEvent.click(screen.getByRole('button', { name: /Cotizar envío/ }))
    await screen.findByText(/FedEx/)
    fireEvent.click(screen.getByRole('button', { name: /Generar guía/ }))
    expect(await screen.findByTestId('guia-sandbox')).toHaveTextContent(/ambiente de pruebas: no es un envío real/)
    expect(srv.create.mock.calls[0][0].provider).toBe('t1'); expect(srv.create.mock.calls[0][0].rate.amount).toBe(140)   // el total que vio el operador viaja para confirmarse en el servidor
  })
  it('si el servidor reporta cambio de precio, no hay guía y el mensaje pide recotizar', async () => {
    srv.quote.mockResolvedValue([{ id: 'DHL|EXPRESS_DOMESTIC', serviceCode: 'DHL|EXPRESS_DOMESTIC', carrier: 'DHL', service: 'Express · Dia Siguiente', amount: 376.16, currency: 'MXN', etaDays: 1 }])
    srv.create.mockRejectedValue(new Error('T1 cambió el total de DHL · Express · Dia Siguiente: de $376.16 a $390.00. Vuelve a cotizar y confirma antes de generar la guía.'))
    render(<AsignarModal order={ORDER} onClose={() => {}} />)
    for (const [l, v] of [['Peso en kilogramos', '1'], ['Largo en centímetros', '30'], ['Ancho en centímetros', '20'], ['Alto en centímetros', '10']]) fireEvent.change(screen.getByLabelText(l), { target: { value: v } })
    fireEvent.click(screen.getByRole('button', { name: /Cotizar envío/ }))
    await screen.findByText(/Express · Dia Siguiente/)
    fireEvent.click(screen.getByRole('button', { name: /Generar guía/ }))
    expect(await screen.findByText(/T1 cambió el total[^]*Vuelve a cotizar/)).toBeTruthy()
    expect(screen.queryByTestId('guia-sandbox')).toBeNull()
  })
})

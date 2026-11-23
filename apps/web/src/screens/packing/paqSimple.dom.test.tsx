// @vitest-environment jsdom
// PAQ-SIMPLE (23 nov 2026) · en Empaque: la paquetería vendida (DHL o Estafeta) viene preseleccionada; con DHL Almacén elige
// CUALQUIER servicio permitido sin motivo (ECONOMY SELECT no aparece); con Estafeta registra la guía MANUAL y el pedido sigue
// el flujo normal (En camino).
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const srv = vi.hoisted(() => ({ quote: vi.fn(), create: vi.fn(), createShipment: vi.fn(), markShipped: vi.fn() }))
vi.mock('../../data/shipping/provider', async (orig) => ({ ...(await orig<typeof import('../../data/shipping/provider')>()), quoteShipment: srv.quote, createShipmentReal: srv.create }))
vi.mock('../../data/shipping/shipper', () => ({ shipperFromCompany: () => ({ config: { name: 'Renovacell', addressLine1: 'Blvd 1', city: 'Culiacán', state: 'Sin', cp: '80000', country: 'MX', phone: '6671112233', email: 'a@b.mx' } }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ createShipment: srv.createShipment }) }))
vi.mock('../../data/store/ordersStore', () => ({ markShipped: srv.markShipped }))
vi.mock('../../data/ops/empaques', () => ({ listarEmpaques: async () => ({ ok: true, data: [] }), medidasTexto: () => '' }))
vi.mock('../../data/store/driversStore', () => ({ getDrivers: () => [] }))
vi.mock('../../auth/RoleContext', () => { const r = { role: 'warehouse', user: { name: 'Alberto' } }; return { useRole: () => r, useRoleOpcional: () => r } })
import { AsignarModal } from './Cola'
import { validarGuiaEstafeta, validarCostoGuia, registrarGuiaEstafeta } from '../../data/shipping/estafeta'

beforeEach(() => {
  cleanup(); srv.quote.mockReset(); srv.create.mockReset(); srv.createShipment.mockReset(); srv.markShipped.mockReset()
  srv.markShipped.mockResolvedValue({ ok: true })
})

const pedido = (paq: 'dhl' | 'estafeta') => ({ id: 'o1', external_ref: 'S100010', status: 'packed', created_at: '2026-11-23T10:00:00Z', items: [],
  shipping_meta: { customer: { name: 'Dra. Ana Ruiz', phone: '5512345678' }, address: { line1: 'Av. Reforma 123', colonia: 'Centro', cp: '06600', city: 'Ciudad de México', state: 'CDMX', phone: '5512345678' },
    entrega: { opcion: `foraneo_${paq}`, tipo: 'foraneo', paqueteria: paq, texto: `Envío por ${paq}`, flete: 600, flete_regla: 600, salida: '2026-11-23', llega_desde: '2026-11-25', llega_hasta: paq === 'dhl' ? '2026-11-25' : '2026-11-27',
      ...(paq === 'dhl' ? { servicio: { proveedor: 'dhl', llega_fecha: '2026-11-25', cotizacion_id: 'c1', promesa: 'mas_tardia' } } : {}) } } }) as never
const medir = () => { for (const [l, v] of [['Peso en kilogramos', '1'], ['Largo en centímetros', '30'], ['Ancho en centímetros', '20'], ['Alto en centímetros', '10']]) fireEvent.change(screen.getByLabelText(l), { target: { value: v } }) }

describe('PAQ-SIMPLE · Almacén elige el servicio', () => {
  it('DHL vendido: preseleccionado, se ve la promesa, ECONOMY SELECT no aparece y cualquier servicio se genera SIN motivo', async () => {
    srv.quote.mockResolvedValue([
      { id: 'G', serviceCode: 'G', carrier: 'DHL', service: 'ECONOMY SELECT', amount: 150, currency: 'MXN', etaDays: 5 },
      { id: 'N', serviceCode: 'N', carrier: 'DHL', service: 'EXPRESS DOMESTIC', amount: 330, currency: 'MXN', etaDays: 2 },
      { id: '1', serviceCode: '1', carrier: 'DHL', service: 'EXPRESS 12:00', amount: 420, currency: 'MXN', etaDays: 1 },
    ])
    srv.create.mockResolvedValue({ label: { provider: 'dhl', ambiente: 'production', carrier: 'DHL', service: 'EXPRESS 12:00', serviceCode: '1', tracking: '123', labelUrl: 'https://x/l.pdf', amount: 420, etaDays: 1, estimatedDeliveryAt: '2026-11-24T19:00:00Z' } })
    render(<AsignarModal order={pedido('dhl')} onClose={() => {}} />)
    expect(screen.getByTestId('proveedor-dhl').className).toBe('active')
    expect(screen.getByTestId('paqueteria-vendida')).toHaveTextContent(/DHL · llega el miércoles 25 de nov/)
    medir()
    fireEvent.click(screen.getByRole('button', { name: /Cotizar envío/ }))
    expect(await screen.findByText(/EXPRESS 12:00/)).toBeTruthy()
    expect(screen.queryByText(/ECONOMY SELECT/)).toBeNull()
    fireEvent.click(screen.getByText(/EXPRESS 12:00/).closest('label')!.querySelector('input')!)
    expect(screen.queryByTestId('cambio-servicio')).toBeNull()   // sin caja de motivo
    fireEvent.click(screen.getByRole('button', { name: /Generar guía/ }))
    await waitFor(() => expect(srv.create).toHaveBeenCalledTimes(1))
    const args = srv.create.mock.calls[0][0]
    expect(args.rate.serviceCode).toBe('1'); expect(args).not.toHaveProperty('cambio_motivo')
    await waitFor(() => expect(srv.markShipped).toHaveBeenCalledWith('o1', expect.objectContaining({ method: 'paqueteria', carrier: 'DHL', tracking: '123' })))
  })
  it('Estafeta vendido: preseleccionada, guía MANUAL validada; se registra con provider estafeta y el pedido pasa a enviado', async () => {
    srv.createShipment.mockResolvedValue({ ok: true, shipment: { id: 's1', estimated_delivery_at: '2026-11-28T01:00:00.000Z' } })
    render(<AsignarModal order={pedido('estafeta')} onClose={() => {}} />)
    expect(screen.getByTestId('proveedor-estafeta').className).toBe('active')
    expect(screen.getByTestId('estafeta-manual')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cotizar envío/ })).toBeNull()
    expect((screen.getByTestId('estafeta-fecha') as HTMLInputElement).value).toBe('2026-11-27')   // de inicio, la fecha prometida
    fireEvent.change(screen.getByTestId('estafeta-guia'), { target: { value: '12345' } })
    fireEvent.click(screen.getByTestId('estafeta-guardar'))
    expect(await screen.findByTestId('estafeta-error')).toHaveTextContent(/22 caracteres/)
    expect(srv.createShipment).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('estafeta-guia'), { target: { value: '8055 2414 5012 3456 7890 12' } })
    fireEvent.change(screen.getByTestId('estafeta-costo'), { target: { value: '185.50' } })
    fireEvent.click(screen.getByTestId('estafeta-guardar'))
    await waitFor(() => expect(srv.createShipment).toHaveBeenCalledTimes(1))
    expect(srv.createShipment.mock.calls[0][0]).toMatchObject({ order_id: 'o1', carrier: 'Estafeta', tracking_number: '8055241450123456789012', provider: 'estafeta', provider_cost: 185.5, status: 'in_transit', estimated_delivery_at: '2026-11-28T01:00:00.000Z' })
    await waitFor(() => expect(srv.markShipped).toHaveBeenCalledWith('o1', { method: 'paqueteria', carrier: 'Estafeta', tracking: '8055241450123456789012' }))
    expect(await screen.findByTestId('estafeta-rastreo')).toHaveAttribute('href', expect.stringContaining('estafeta.com'))
  })
  it('DHL vendido, Almacén cambia a Estafeta: aviso y guía manual', () => {
    render(<AsignarModal order={pedido('dhl')} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('proveedor-estafeta'))
    expect(screen.getByTestId('estafeta-manual')).toBeInTheDocument()
    expect(screen.getByTestId('proveedor-guia')).toHaveTextContent(/Se vendió con DHL; estás generando con otra paquetería/)
  })
})

describe('PAQ-SIMPLE · guía manual de Estafeta (reglas)', () => {
  it('número de guía (22) o código de rastreo (10 dígitos); costo opcional', async () => {
    expect(validarGuiaEstafeta(' 8055-2414-5012-3456-7890-12 ')).toEqual({ ok: true, guia: '8055241450123456789012' })
    expect(validarGuiaEstafeta('1234567890')).toEqual({ ok: true, guia: '1234567890' })
    expect(validarGuiaEstafeta('').ok).toBe(false)
    expect(validarGuiaEstafeta('ABC#123').ok).toBe(false)
    expect(validarGuiaEstafeta('12345678901').ok).toBe(false)
    expect(validarCostoGuia('')).toEqual({ ok: true, costo: null })
    expect(validarCostoGuia('$1,250.5')).toEqual({ ok: true, costo: 1250.5 })
    expect(validarCostoGuia('-3').ok).toBe(false)
    const crear = vi.fn(async () => ({ ok: true as const, shipment: {} as never }))
    await registrarGuiaEstafeta({ orderId: 'o9', guia: '1234567890', costo: null, llegaFecha: null, registradoPor: 'Alberto' }, crear)
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ provider: 'estafeta', carrier: 'Estafeta', provider_cost: null, currency: null, estimated_delivery_at: null, provider_meta: expect.objectContaining({ manual: true }) }))
  })
})

// Auditoría pre-operación (28 oct): recoge en sucursal no es un envío atorado; el envío que cuenta es el vigente.
import { describe, it, expect } from 'vitest'
import { diagnoseShipment, envioVigente, esRecoge } from './seguimiento'
import { statusView } from '../../screens/doctor/orderStatus'
import type { Shipment } from '../types'

const pedido = (p: Record<string, unknown>) => ({ id: 'o1', status: 'shipped', created_at: '2026-10-20T10:00:00Z', items: [], shipping_meta: {}, ...p }) as never
const envio = (p: Partial<Shipment>) => ({ id: 's', order_id: 'o1', status: 'por_despachar', created_at: '2026-10-20T10:00:00Z', ...p }) as Shipment

describe('recoge en sucursal', () => {
  it('se reconoce por el método del pedido', () => {
    expect(esRecoge(pedido({ shipping_meta: { method: 'recoge' } }))).toBe(true)
    expect(esRecoge(pedido({ shipping_meta: { method: 'chofer' } }))).toBe(false)
  })
  it('"Listo para recoger", no "surtido sin salir" ni detenido', () => {
    const d = diagnoseShipment(pedido({ shipping_meta: { method: 'recoge' } }), undefined)
    expect(d).toMatchObject({ statusLabel: 'Listo para recoger', stuck: false })
  })
  it('el doctor lo ve listo para recoger, no "en camino"', () => {
    expect(statusView('shipped', { recoge: true }).label).toBe('Listo para recoger')
    expect(statusView('shipped').label).toBe('En camino')
  })
})

describe('envío vigente', () => {
  it('un envío cancelado no tapa al vigente', () => {
    const xs = [envio({ id: 'viejo', status: 'cancelado', created_at: '2026-10-21T10:00:00Z' }), envio({ id: 'vivo', status: 'por_despachar', created_at: '2026-10-20T10:00:00Z' })]
    expect(envioVigente(xs, 'o1')?.id).toBe('vivo')
  })
  it('si todos están cancelados, el más reciente', () => {
    const xs = [envio({ id: 'a', status: 'cancelado', created_at: '2026-10-20T10:00:00Z' }), envio({ id: 'b', status: 'cancelado', created_at: '2026-10-22T10:00:00Z' })]
    expect(envioVigente(xs, 'o1')?.id).toBe('b')
  })
})

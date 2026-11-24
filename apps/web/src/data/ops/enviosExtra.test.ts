// ENVÍOS EXTRA (24 nov 2026) · reparto de piezas entre envíos, lo que viaja al servidor, y las guardas de servidor/Edge.
import { describe, it, expect } from 'vitest'
import { envioDePaquete, extrasDe, extrasParaServidor, extrasSinGuia, faltaEnExtras, pedidoDePaquete, restoPrincipal, type EnvioExtraBorrador } from './enviosExtra'
import { envioVigente } from './seguimiento'
import type { Shipment } from '../types'
import type { OrderWithItems } from '../store/ordersStore'
import migracion from '../../../../../supabase/migrations/20270407850000_envios_extra.sql?raw'
import edge from '../../../../../supabase/functions/shipping/index.ts?raw'
import cola from '../../screens/packing/Cola.tsx?raw'

const MTY = { line1: 'Hidalgo 5', cp: '64000', city: 'Monterrey', state: 'NL', phone: '8111111111' }
const cart = { A: 3, B: 2 }
const sh = (x: Partial<Shipment>): Shipment => ({ id: Math.random().toString(), order_id: 'o1', carrier: 'DHL', tracking_number: 'T', label_url: null, driver_id: null, status: 'in_transit', estimated_delivery_at: null, delivered_at: null, proof_image_url: null, received_by: null, incident: null, created_at: '2026-11-24T10:00:00Z', ...x })
const pedido = { id: 'o1', shipping_meta: { address: { line1: 'Reforma 1', cp: '06600' }, customer: { name: 'Dra. Ana', phone: '555' }, entrega: { tipo: 'foraneo', extras: [
  { paquete: 1, address: MTY, contacto: 'Clínica Norte', lineas: [{ product_id: 'A', qty: 1 }], flete: 600 },
  { paquete: 2, address: { line1: 'Juárez 9', cp: '44100', city: 'Guadalajara' }, lineas: [{ product_id: 'B', qty: 1 }], flete: 600 }] } } } as unknown as OrderWithItems

describe('ENVÍOS EXTRA · reparto al vender', () => {
  it('el principal se queda con lo que no se repartió', () => {
    const ex: EnvioExtraBorrador[] = [{ address: MTY, lineas: { A: 1 } }, { address: MTY, lineas: { A: 1, B: 2 } }]
    expect(restoPrincipal(cart, ex)).toEqual({ A: 1, B: 0 })
    expect(faltaEnExtras(cart, ex, () => false)).toBeNull()
  })
  it('pide domicilio con C.P., productos, no más piezas de las que hay, algo en el principal y nada local', () => {
    expect(faltaEnExtras(cart, [{ address: null, lineas: { A: 1 } }], () => false)).toMatch(/domicilio/)
    expect(faltaEnExtras(cart, [{ address: MTY, lineas: {} }], () => false)).toMatch(/qué productos/)
    expect(faltaEnExtras(cart, [{ address: MTY, lineas: { A: 4 } }], () => false)).toMatch(/más piezas/)
    expect(faltaEnExtras(cart, [{ address: MTY, lineas: { A: 3, B: 2 } }], () => false)).toMatch(/principal/)
    expect(faltaEnExtras(cart, [{ address: MTY, lineas: { A: 1 } }], () => true)).toMatch(/Culiacán/)
  })
  it('al servidor viaja domicilio y líneas con cantidad', () => {
    expect(extrasParaServidor([{ address: MTY, lineas: { A: 1, B: 0 } }])).toEqual([{ address: MTY, lineas: [{ product_id: 'A', qty: 1 }] }])
  })
})

describe('ENVÍOS EXTRA · almacén', () => {
  it('cada paquete tiene su envío; el principal (envioVigente) ignora los extras', () => {
    const lista = [sh({ paquete: 1, tracking_number: 'X1' }), sh({ paquete: 0, tracking_number: 'P0', created_at: '2026-11-24T09:00:00Z' })]
    expect(envioVigente(lista, 'o1')?.tracking_number).toBe('P0')
    expect(envioDePaquete(lista, 'o1', 1)?.tracking_number).toBe('X1')
    expect(extrasSinGuia(pedido, lista).map((x) => x.paquete)).toEqual([2])
  })
  it('la guía de un extra va al domicilio del extra y a quien recibe ahí', () => {
    const x = extrasDe(pedido)[0]
    const p = pedidoDePaquete(pedido, x)
    expect((p.shipping_meta as { address: { city: string } }).address.city).toBe('Monterrey')
    expect((p.shipping_meta as { customer: { name: string } }).customer.name).toBe('Clínica Norte')
    expect(p.id).toBe('o1')
  })
  it('la guía de un extra no marca el pedido enviado y lleva su paquete', () => {
    expect(cola).toMatch(/if \(paquete > 0\) \{ setResult\(label\); setBusy\(false\); return \}\s*\n\s*const enviado = await markShipped/)
    expect(cola).toMatch(/idempotencyKey: paquete > 0 \? `\$\{order\.id\}:p\$\{paquete\}:\$\{rate\.id\}`/)
  })
})

describe('ENVÍOS EXTRA · servidor', () => {
  it('Edge: guía, etiqueta, recolección, rastreo e intentos por paquete', () => {
    expect(edge).toMatch(/const paquete = Math\.max\(0, Math\.min\(10, Math\.floor\(Number\(p\.paquete\) \|\| 0\)\)\)/)
    expect(edge.match(/\.eq\('order_id', orderId\)\.eq\('paquete', paquete\)\.not\('tracking_number', 'is', null\)/g)?.length).toBe(5)
    expect(edge).toMatch(/order_id: orderId, paquete, provider: 'dhl'/)
    expect(edge).toMatch(/order_id: orderId, paquete, carrier: 'DHL'/)
  })
  it('base: un envío vivo por paquete, $600 por extra, aviso con su guía y "Entregado" cuando llegaron todos', () => {
    expect(migracion).toMatch(/uq_shipments_un_envio_vivo on public\.shipments \(order_id, paquete\)/)
    expect(migracion).toMatch(/envio_extra_costo numeric\(12,2\) not null default 600/)
    expect(migracion).toMatch(/ENVIO_EXTRA_LOCAL/)
    expect(migracion).toMatch(/'pedido_enviado:' \|\| v_order \|\| ':p' \|\| v_paquete/)
    expect(migracion).toMatch(/x\.paquete > 0 and x\.status = ''delivered''/)
  })
})

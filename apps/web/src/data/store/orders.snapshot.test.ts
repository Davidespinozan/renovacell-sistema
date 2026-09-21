// Snapshot de dirección en el pedido (Fase 2/2b). El address viaja completo en
// shipping_meta.address; location_id es referencia opcional. POS sin doctor NO cambia.
import { describe, it, expect } from 'vitest'
import { createOrder, createPosOrder } from './ordersStore'

const addr = { line1: 'Av. Central 50', colonia: 'Roma', cp: '06700', city: 'CDMX', state: 'CDMX' }

describe('createOrder — snapshot de entrega + location_id', () => {
  it('con ubicación elegida: guarda address (snapshot) y location_id', () => {
    const o = createOrder({ lines: [{ product_id: 'p1', qty: 1, unit_price: 100 }], total: 100, invoice_requested: false, shipping: addr, location_id: 'loc-9' })
    const m = o.shipping_meta as { address?: unknown; location_id?: string }
    expect(m.address).toEqual(addr)
    expect(m.location_id).toBe('loc-9')
  })

  it('staff "a nombre de": conserva placed_by + address + location_id', () => {
    const o = createOrder({ lines: [{ product_id: 'p1', qty: 1, unit_price: 100 }], total: 100, invoice_requested: false, doctor_id: 'doc-1', placedBy: 'Ventas', shipping: addr, location_id: 'loc-1' })
    const m = o.shipping_meta as { placed_by?: string; address?: unknown; location_id?: string }
    expect(m.placed_by).toBe('Ventas')
    expect(m.address).toEqual(addr)
    expect(m.location_id).toBe('loc-1')
  })

  it('one-off (dirección sin ubicación): address presente, SIN location_id', () => {
    const o = createOrder({ lines: [{ product_id: 'p1', qty: 1, unit_price: 100 }], total: 100, invoice_requested: false, shipping: addr })
    const m = o.shipping_meta as Record<string, unknown>
    expect(m.address).toEqual(addr)
    expect('location_id' in m).toBe(false)
  })

  it('sin dirección ni ubicación: shipping_meta queda null (sin cambios)', () => {
    const o = createOrder({ lines: [{ product_id: 'p1', qty: 1, unit_price: 100 }], total: 100, invoice_requested: false })
    expect(o.shipping_meta).toBeNull()
  })
})

describe('createPosOrder — venta POS sin doctor NO se rompe (§6)', () => {
  it('mostrador sin doctor: sin address ni location_id (solo canal/evento/vendedor)', () => {
    const o = createPosOrder({ lines: [{ product_id: 'p1', qty: 1, unit_price: 100, lot_id: null }], total: 100, payment_method: 'efectivo' }, true)
    const m = o.shipping_meta as Record<string, unknown>
    expect(o.doctor_id).toBeNull()
    expect('address' in m).toBe(false)
    expect('location_id' in m).toBe(false)
    expect(m.channel).toBe('pos')
  })
})

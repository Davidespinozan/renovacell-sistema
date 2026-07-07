// Lógica de consignación, eventos y compras (modo mock).
import { describe, it, expect } from 'vitest'
import * as consigna from './consignaStore'
import * as events from './eventsStore'
import * as compras from './comprasStore'
import { getSnapshotLots } from './lotsStore'
import { stockByProduct } from '../ops/stock'

function productoConStock(): string {
  const map = stockByProduct(getSnapshotLots())
  return Object.keys(map).find((k) => map[k].qty > 0)!
}

describe('consignaStore', () => {
  it('assignToVendor entrega saldo con existencia', () => {
    const pid = productoConStock()
    const r = consigna.assignToVendor('Lucía', pid, 1)
    expect(r.ok).toBe(true)
    const snap = consigna.getSnapshot()['Lucía'] ?? []
    expect(snap.some((i) => i.product_id === pid)).toBe(true)
  })
  it('assignToVendor rechaza sin vendor o cantidad inválida', () => {
    expect(consigna.assignToVendor('', 'p1', 1).ok).toBe(false)
    expect(consigna.assignToVendor('Lucía', 'p1', 0).ok).toBe(false)
  })
  it('assignToVendor reporta faltante si no alcanza', () => {
    const pid = productoConStock()
    const r = consigna.assignToVendor('Diego', pid, 999999)
    expect(r.ok).toBe(false)
    expect(r.missing).toBeGreaterThan(0)
  })
})

describe('eventsStore', () => {
  it('createEvent agrega un evento', () => {
    const e = events.createEvent({ name: 'Congreso QA', venue: 'CDMX', date: '2026-09-01', members: [] })
    expect(events.getSnapshot().some((x) => x.id === e.id)).toBe(true)
  })
  it('updateEvent modifica sus datos', () => {
    const e = events.createEvent({ name: 'Feria QA', venue: 'GDL', date: '2026-09-02', members: [] })
    events.updateEvent(e.id, { venue: 'Monterrey' })
    expect(events.getSnapshot().find((x) => x.id === e.id)?.venue).toBe('Monterrey')
  })
  it('deleteEvent lo elimina', () => {
    const e = events.createEvent({ name: 'Expo QA', venue: 'Tijuana', date: '2026-09-03', members: [] })
    events.deleteEvent(e.id)
    expect(events.getSnapshot().some((x) => x.id === e.id)).toBe(false)
  })
})

describe('comprasStore', () => {
  it('una compra a proveedor nace SIN pagar', () => {
    const po = compras.createReplenishment({ product_id: 'p1', product_name: 'X', qty: 5, unit_cost: 100, kind: 'compra', supplier: 'Prov' })
    expect(po.paid).toBe(false)
    expect(compras.getSnapshot().some((x) => x.id === po.id)).toBe(true)
  })
  it('markPaid la marca como pagada', () => {
    const po = compras.createReplenishment({ product_id: 'p1', product_name: 'X', qty: 5, unit_cost: 100, kind: 'compra', supplier: 'Prov' })
    compras.markPaid(po.id)
    expect(compras.getSnapshot().find((x) => x.id === po.id)?.paid).toBe(true)
  })
})

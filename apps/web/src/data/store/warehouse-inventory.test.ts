// Fase 1 · Fundación de inventario/costo — recepción atómica (mock), compra ≠ stock,
// promedio ponderado, y caducado físico vs disponible.
import { describe, it, expect } from 'vitest'
import { recibirLote, getSnapshotLots } from './lotsStore'
import { createReplenishment, markPaid, getSnapshot as getCompras } from './comprasStore'
import { stockByProduct } from '../ops/stock'
import type { Lot } from '../types'

const lotOf = (pid: string, code: string): Lot | undefined =>
  getSnapshotLots().find((l) => l.product_id === pid && (l.lot_code ?? '').toLowerCase() === code.toLowerCase())
const qtyOf = (pid: string, code: string): number => lotOf(pid, code)?.quantity ?? 0

describe('recibirLote (mock) — entrada/recepción', () => {
  it('lote nuevo → crea lote + suma stock, con costo', async () => {
    const r = await recibirLote({ product_id: 'W1', lot_code: 'L-A', expiry_date: null, quantity: 10, location: 'X', unit_cost: 900 })
    expect(r.ok).toBe(true)
    expect(qtyOf('W1', 'L-A')).toBe(10)
    expect(lotOf('W1', 'L-A')?.unit_cost).toBe(900)
  })
  it('mismo lote otra vez → SUMA (no idempotente)', async () => {
    await recibirLote({ product_id: 'W2', lot_code: 'L-B', expiry_date: null, quantity: 5, location: 'X', unit_cost: 900 })
    await recibirLote({ product_id: 'W2', lot_code: 'L-B', expiry_date: null, quantity: 5, location: 'X', unit_cost: 900 })
    expect(qtyOf('W2', 'L-B')).toBe(10)
    expect(lotOf('W2', 'L-B')?.unit_cost).toBe(900) // mismo costo → sigue 900
  })
  it('mismo lote con costo distinto → promedio ponderado', async () => {
    await recibirLote({ product_id: 'W3', lot_code: 'L-C', expiry_date: null, quantity: 10, location: 'X', unit_cost: 900 })
    await recibirLote({ product_id: 'W3', lot_code: 'L-C', expiry_date: null, quantity: 10, location: 'X', unit_cost: 1000 })
    expect(qtyOf('W3', 'L-C')).toBe(20)
    expect(lotOf('W3', 'L-C')?.unit_cost).toBe(950) // (10*900 + 10*1000)/20
  })
  it('cantidad inválida → error, no crea lote', async () => {
    const r = await recibirLote({ product_id: 'W4', lot_code: 'L-D', expiry_date: null, quantity: 0, location: 'X', unit_cost: 100 })
    expect(r.ok).toBe(false)
    expect(lotOf('W4', 'L-D')).toBeUndefined()
  })
  it('falta lote → error', async () => {
    const r = await recibirLote({ product_id: 'W5', lot_code: '  ', expiry_date: null, quantity: 5, location: 'X', unit_cost: 100 })
    expect(r.ok).toBe(false)
  })
})

describe('compra ≠ recepción (no aumenta stock)', () => {
  it('createReplenishment NO crea lote/stock', () => {
    const before = getSnapshotLots().length
    createReplenishment({ product_id: 'WP', product_name: 'Prod WP', qty: 20, unit_cost: 950, kind: 'compra', supplier: 'ACME' })
    expect(getSnapshotLots().length).toBe(before)   // ningún lote nuevo
    expect(qtyOf('WP', 'cualquiera')).toBe(0)
    expect(getCompras().some((o) => o.product_id === 'WP' && o.status === 'pendiente')).toBe(true)
  })
  it('markPaid NO afecta stock', () => {
    const po = createReplenishment({ product_id: 'WP2', product_name: 'Prod WP2', qty: 5, unit_cost: 100, kind: 'compra', supplier: 'ACME' })
    const before = getSnapshotLots().length
    markPaid(po.id)
    expect(getSnapshotLots().length).toBe(before)
    expect(getCompras().find((o) => o.id === po.id)?.paid).toBe(true)
    expect(getCompras().find((o) => o.id === po.id)?.status).toBe('pendiente') // pago independiente de recepción
  })
})

describe('caducado: existe físicamente pero NO disponible para venta', () => {
  it('stockByProduct excluye lotes caducados', () => {
    const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const lots: Lot[] = [
      { id: 'x1', product_id: 'EXP', lot_code: 'VIGENTE', manufacture_date: null, expiry_date: null, quantity: 8, location: null, unit_cost: 0, metadata: null },
      { id: 'x2', product_id: 'EXP', lot_code: 'CADUCO', manufacture_date: null, expiry_date: ayer, quantity: 5, location: null, unit_cost: 0, metadata: null },
    ]
    const fisica = lots.reduce((s, l) => s + l.quantity, 0)
    const disponible = stockByProduct(lots)['EXP']?.qty ?? 0
    expect(fisica).toBe(13)          // física incluye caducado
    expect(disponible).toBe(8)       // disponible excluye el lote caducado
  })
})

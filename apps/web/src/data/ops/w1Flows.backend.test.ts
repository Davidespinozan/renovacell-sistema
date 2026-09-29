// W1 · flujos con BACKEND (hasSupabase=true): contrato de payload + sin éxito optimista.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  markPacked: vi.fn(),
  createPosOrder: vi.fn((i: { id?: string; folio?: string }) => ({ id: i.id, external_ref: i.folio, items: [] })),
  lots: [
    { id: 'L-A1', product_id: 'P-A', lot_code: 'A1', expiry_date: '2099-01-01', quantity: 3, location: null, manufacture_date: null, unit_cost: null, metadata: null },
    { id: 'L-A2', product_id: 'P-A', lot_code: 'A2', expiry_date: '2099-06-01', quantity: 10, location: null, manufacture_date: null, unit_cost: null, metadata: null },
  ],
}))
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: h.rpc } }))
vi.mock('../store/lotsStore', () => ({ getSnapshotLots: () => h.lots, consume: vi.fn(), reloadInventory: vi.fn() }))
vi.mock('../store/ordersStore', () => ({
  markPacked: h.markPacked, reloadOrders: vi.fn(), createPosOrder: h.createPosOrder,
  posShippingMeta: (i: { seller?: string | null }) => ({ channel: 'pos', event_id: null, seller: i.seller ?? null }),
}))

import { surtirPedido } from './surtir'
import { venderPOS } from './pos'
import type { OrderWithItems } from '../store/ordersStore'

const order = {
  id: 'O-1', external_ref: 'S1', status: 'paid',
  items: [{ id: 'I-1', order_id: 'O-1', product_id: 'P-A', lot_id: null, qty: 5, unit_price: 100, created_at: '' }],
} as unknown as OrderWithItems

beforeEach(() => { h.rpc.mockReset(); h.markPacked.mockClear(); h.createPosOrder.mockClear() })

describe('surtirPedido (W1)', () => {
  it('manda asignaciones POR RENGLÓN (order_item_id + lote + qty) con el op_id de la intención', async () => {
    h.rpc.mockResolvedValueOnce({ data: { status: 'applied' }, error: null })
    const r = await surtirPedido(order, 'op-s1')
    expect(r.ok).toBe(true)
    expect(h.rpc).toHaveBeenCalledWith('surtir_pedido', {
      p_op_id: 'op-s1', p_order: 'O-1',
      p_allocations: [{ order_item_id: 'I-1', lot_id: 'L-A1', qty: 3 }, { order_item_id: 'I-1', lot_id: 'L-A2', qty: 2 }],
    })
    expect(h.markPacked).toHaveBeenCalledTimes(1) // solo DESPUÉS de la confirmación
  })
  it('rechazo del servidor ⇒ sin empacado optimista y error visible', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'LOTE_CADUCADO: el lote L-A1 caducó' } })
    const r = await surtirPedido(order, 'op-s2')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/caducado/)
    expect(h.markPacked).not.toHaveBeenCalled()
  })
  it('respuesta ambigua ⇒ ambiguo, sin empacado; el reintento usa el MISMO op_id', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } }).mockResolvedValueOnce({ data: null, error: null })
    const r1 = await surtirPedido(order, 'op-s3')
    expect(r1.ambiguous).toBe(true)
    expect(h.markPacked).not.toHaveBeenCalled()
    h.rpc.mockResolvedValueOnce({ data: { status: 'already_applied' }, error: null })
    const r2 = await surtirPedido(order, 'op-s3')
    expect(r2.ok).toBe(true)
    expect((h.rpc.mock.calls[h.rpc.mock.calls.length - 1] as unknown[])[1]).toMatchObject({ p_op_id: 'op-s3' })
  })
})

describe('venderPOS (W1)', () => {
  const op = { orderId: '11111111-1111-4111-8111-111111111111', folio: 'POS-000001' }
  it('order_id = op_id, asignaciones con line_index, ticket SOLO tras confirmar', async () => {
    h.rpc.mockResolvedValueOnce({ data: true, error: null })
    const r = await venderPOS([{ product_id: 'P-A', qty: 4, unit_price: 50 }], 200, 'efectivo', { op })
    expect(r.ok).toBe(true)
    const [name, args] = h.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('vender_pos')
    expect(args.p_order_id).toBe(op.orderId)
    expect(args.p_folio).toBe(op.folio)
    expect(args.p_allocations).toEqual([{ line_index: 0, lot_id: 'L-A1', qty: 3 }, { line_index: 0, lot_id: 'L-A2', qty: 1 }])
    expect(h.createPosOrder).toHaveBeenCalledWith(expect.objectContaining({ id: op.orderId, folio: op.folio }), true)
  })
  it('rechazo ⇒ no se crea ticket local (sin venta fantasma)', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Inventario insuficiente en el lote L-A1' } })
    const r = await venderPOS([{ product_id: 'P-A', qty: 4, unit_price: 50 }], 200, 'efectivo', { op })
    expect(r.ok).toBe(false)
    expect(h.createPosOrder).not.toHaveBeenCalled()
  })
})

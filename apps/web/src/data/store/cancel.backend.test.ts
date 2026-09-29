// W1 · cancelarPedido con BACKEND: comando del servidor, sin escrituras directas ni reingreso local.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'maybeSingle', 'single']) chain[m] = vi.fn(() => chain)
  ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
  return { chain, rpc: vi.fn(), from: vi.fn(() => chain), restock: vi.fn() }
})
vi.mock('../../lib/supabase', () => ({
  hasSupabase: true, currentUserId: () => null,
  supabase: { rpc: h.rpc, from: h.from, auth: { onAuthStateChange: vi.fn() } },
}))
vi.mock('./notificationsStore', () => ({ notify: vi.fn() }))
vi.mock('./auditStore', () => ({ logAudit: vi.fn() }))
vi.mock('./lotsStore', () => ({ restockByReference: h.restock }))

import { cancelarPedido, cancelOrder } from './ordersStore'

beforeEach(() => { h.rpc.mockReset(); h.chain.update.mockClear(); h.restock.mockClear() })

describe('cancelarPedido (W1)', () => {
  it('llama cancelar_pedido con op_id + motivo y refleja reingreso pendiente / reembolso en revisión', async () => {
    h.rpc.mockResolvedValueOnce({ data: { status: 'applied', refund_review: 'pendiente_revision', reingreso_pendiente: true }, error: null })
    const r = await cancelarPedido('O-9', { opId: 'op-c1', reason: 'Cliente desistió' })
    expect(h.rpc).toHaveBeenCalledWith('cancelar_pedido', { p_op_id: 'op-c1', p_order: 'O-9', p_reason: 'Cliente desistió' })
    expect(r).toMatchObject({ ok: true, refundReview: 'pendiente_revision', reingresoPendiente: true })
    expect(h.chain.update).not.toHaveBeenCalled()   // ninguna escritura directa a orders
    expect(h.restock).not.toHaveBeenCalled()        // el stock NO reaparece por la UI
  })
  it('regla del servidor (pagado ⇒ Dirección) llega como error de operador', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'CANCELACION_REQUIERE_DIRECCION: pedido S1 (paid)' } })
    const r = await cancelarPedido('O-9', { opId: 'op-c2', reason: 'x' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/solo lo puede cancelar Dirección/)
  })
  it('el camino local (cancelOrder) queda deshabilitado con backend', () => {
    expect(cancelOrder('O-9').ok).toBe(false)
    expect(h.chain.update).not.toHaveBeenCalled()
  })
})

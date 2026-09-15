// P0-A (auditoría de cierre) — EL FRONTEND NO ES AUTORIDAD DEL PRECIO.
// Estos tests fuerzan la ruta BACKEND (mockeando lib/supabase con hasSupabase=true) y
// demuestran que el cliente: (1) solo manda {product_id, qty} al RPC crear_pedido —nunca
// unit_price ni total—, (2) no inserta orders/order_items directo, (3) refleja/queda con lo
// que decide el servidor y (4) revierte el pedido optimista si el servidor rechaza.
// La autoridad REAL del precio (calcular 13500 aunque el cliente mande 1, rechazar producto
// sin precio, cantidad<=0, lista ajena) se prueba en el self-test SQL de la migración
// 20260915120000_p0_precio_servidor.sql (precio_de + crear_pedido no reciben precio por firma).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'order', 'maybeSingle', 'single']) {
    chain[m] = vi.fn(() => chain)
  }
  ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
  const rpc = vi.fn(async () => ({ data: { order_id: 'srv', total: 13500, items: [] }, error: null }))
  const from = vi.fn(() => chain)
  return { chain, rpc, from }
})

vi.mock('../../lib/supabase', () => ({
  hasSupabase: true,
  currentUserId: () => 'd0000000-0000-4000-8000-000000000001',
  supabase: { rpc: h.rpc, from: h.from, auth: { onAuthStateChange: vi.fn() } },
}))
vi.mock('./notificationsStore', () => ({ notify: vi.fn() }))
vi.mock('./auditStore', () => ({ logAudit: vi.fn() }))
vi.mock('./lotsStore', () => ({ restockByReference: vi.fn() }))

import { createOrder, getSnapshotAll } from './ordersStore'

const DOCTOR = 'd0000000-0000-4000-8000-000000000001'
const PROD = 'a0000000-0000-4000-8000-0000000000ab'
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  h.rpc.mockClear()
  h.chain.insert.mockClear()
  h.rpc.mockResolvedValue({ data: { order_id: 'srv', total: 13500, items: [] }, error: null } as never)
})

describe('P0-A · el frontend NO es autoridad del precio', () => {
  it('manda SOLO {product_id, qty} al RPC crear_pedido — nunca unit_price ni total', async () => {
    // Cliente intenta manipular: unit_price=1 y total=1 para un producto caro.
    createOrder({ lines: [{ product_id: PROD, qty: 3, unit_price: 1 }], total: 1, invoice_requested: false, doctor_id: DOCTOR })
    await tick()
    expect(h.rpc).toHaveBeenCalledTimes(1)
    const [name, args] = h.rpc.mock.calls[0] as unknown as [string, { p_total?: unknown; p_lines: Array<Record<string, unknown>> }]
    expect(name).toBe('crear_pedido')
    // El payload no lleva total ni precio: es imposible que el cliente los imponga.
    expect(args).not.toHaveProperty('p_total')
    for (const l of args.p_lines) {
      expect(l).toHaveProperty('product_id')
      expect(l).toHaveProperty('qty')
      expect(l).not.toHaveProperty('unit_price')
      expect(l).not.toHaveProperty('price')
    }
    // Tampoco manda la lista de precios: la elige el servidor desde el perfil del doctor.
    expect(args).not.toHaveProperty('p_list')
  })

  it('NO inserta orders/order_items directo desde el cliente (todo pasa por el RPC)', async () => {
    createOrder({ lines: [{ product_id: PROD, qty: 2, unit_price: 999 }], total: 999, invoice_requested: false, doctor_id: DOCTOR })
    await tick()
    expect(h.chain.insert).not.toHaveBeenCalled()
  })

  it('si el servidor RECHAZA (precio inválido / no autorizado), revierte el pedido optimista', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Producto sin precio válido' } } as never)
    const o = createOrder({ lines: [{ product_id: PROD, qty: 1, unit_price: 1 }], total: 1, invoice_requested: false, doctor_id: DOCTOR })
    await tick()
    expect(getSnapshotAll().find((x) => x.id === o.id)).toBeUndefined()
  })
})

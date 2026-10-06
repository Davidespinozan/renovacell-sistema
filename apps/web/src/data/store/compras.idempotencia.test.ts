// UX-2 / P2-1 · La compra a proveedor es idempotente por intención (op_id): doble clic o reintento
// devuelven la MISMA orden; una intención nueva (otro op_id) crea otra. Sin backend el store
// reproduce la semántica del comando `crear_orden_compra`.
import { describe, it, expect } from 'vitest'
import { createReplenishment, getSnapshot, markPaid, PUEDE_MARCAR_PAGADO } from './comprasStore'

describe('createReplenishment · idempotencia por op_id', () => {
  it('17 · mismo op_id dos veces ⇒ una sola orden (already_applied)', async () => {
    const antes = getSnapshot().length
    const op = 'op-ux2-1'
    const a = await createReplenishment({ product_id: 'px', product_name: 'Prod X', qty: 10, unit_cost: 5, kind: 'compra', supplier: 'Prov' }, op)
    const b = await createReplenishment({ product_id: 'px', product_name: 'Prod X', qty: 10, unit_cost: 5, kind: 'compra', supplier: 'Prov' }, op)
    if (!a.ok || !b.ok) throw new Error('alta falló')
    expect(b.order.id).toBe(a.order.id)
    expect(b.status).toBe('already_applied')
    expect(getSnapshot().length).toBe(antes + 1)
    expect(a.order.status).toBe('pendiente'); expect(a.order.received_qty).toBe(0); expect(a.order.paid).toBe(false)
  })
  it('otro op_id ⇒ otra orden', async () => {
    const antes = getSnapshot().length
    await createReplenishment({ product_id: 'py', product_name: 'Prod Y', qty: 1, unit_cost: 1, kind: 'produccion' }, 'op-ux2-2')
    await createReplenishment({ product_id: 'py', product_name: 'Prod Y', qty: 1, unit_cost: 1, kind: 'produccion' }, 'op-ux2-3')
    expect(getSnapshot().length).toBe(antes + 2)
  })
  it('18/19 · la autoridad de "Marcar pagado" es Dirección/Facturación; almacén no', async () => {
    expect(PUEDE_MARCAR_PAGADO('admin')).toBe(true); expect(PUEDE_MARCAR_PAGADO('billing')).toBe(true)
    expect(PUEDE_MARCAR_PAGADO('warehouse')).toBe(false); expect(PUEDE_MARCAR_PAGADO('pos')).toBe(false); expect(PUEDE_MARCAR_PAGADO(null)).toBe(false)
    const r = await createReplenishment({ product_id: 'pz', product_name: 'Prod Z', qty: 2, unit_cost: 3, kind: 'compra', supplier: 'P' }, 'op-ux2-4')
    if (!r.ok) throw new Error('alta falló')
    expect((await markPaid(r.order.id)).ok).toBe(true)
  })
})

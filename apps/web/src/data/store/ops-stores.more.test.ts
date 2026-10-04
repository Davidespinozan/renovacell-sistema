// Lógica de compras (modo mock).
// La consignación y los eventos ya NO viven aquí: W2-C los unificó en la custodia, que
// se escribe por comandos del servidor y se prueba en el arnés de BD (w2c_*) y en
// custody.test.ts. Sus contadores JSON locales desaparecieron a propósito.
import { describe, it, expect } from 'vitest'
import * as compras from './comprasStore'

// W4: una orden solo "existe" cuando el store la confirmó.
const orden = async (p: ReturnType<typeof compras.createReplenishment>) => {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.order
}

describe('comprasStore', () => {
  it('una compra a proveedor nace SIN pagar', async () => {
    const po = await orden(compras.createReplenishment({ product_id: 'p1', product_name: 'X', qty: 5, unit_cost: 100, kind: 'compra', supplier: 'Prov' }))
    expect(po.paid).toBe(false)
    expect(compras.getSnapshot().some((x) => x.id === po.id)).toBe(true)
  })
  it('markPaid la marca como pagada', async () => {
    const po = await orden(compras.createReplenishment({ product_id: 'p1', product_name: 'X', qty: 5, unit_cost: 100, kind: 'compra', supplier: 'Prov' }))
    await compras.markPaid(po.id)
    expect(compras.getSnapshot().find((x) => x.id === po.id)?.paid).toBe(true)
  })
})

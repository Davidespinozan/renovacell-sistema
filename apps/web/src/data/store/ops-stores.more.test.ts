// Lógica de compras (modo mock).
// La consignación y los eventos ya NO viven aquí: W2-C los unificó en la custodia, que
// se escribe por comandos del servidor y se prueba en el arnés de BD (w2c_*) y en
// custody.test.ts. Sus contadores JSON locales desaparecieron a propósito.
import { describe, it, expect } from 'vitest'
import * as compras from './comprasStore'

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

// Venta en Punto de Venta (venderPOS) sobre los stores mock: FEFO + orden POS.
import { describe, it, expect } from 'vitest'
import { venderPOS } from './pos'
import { getSnapshotLots } from '../store/lotsStore'
import { stockByProduct } from './stock'

// Elige un producto con existencia real del inventario mock.
function productoConStock(): { id: string; qty: number } {
  const map = stockByProduct(getSnapshotLots())
  const pid = Object.keys(map).find((k) => map[k].qty > 0)!
  return { id: pid, qty: map[pid].qty }
}

describe('venderPOS', () => {
  it('sin renglones no vende', () => {
    expect(venderPOS([], 0, 'efectivo').ok).toBe(false)
  })

  it('vende un producto con existencia y crea la orden POS', () => {
    const { id } = productoConStock()
    const r = venderPOS([{ product_id: id, qty: 1, unit_price: 500 }], 500, 'efectivo')
    expect(r.ok).toBe(true)
    expect(r.order).toBeTruthy()
    expect(r.order?.external_ref?.startsWith('POS')).toBe(true)
  })

  it('reporta faltante si se pide más de lo disponible', () => {
    const { id, qty } = productoConStock()
    const r = venderPOS([{ product_id: id, qty: qty + 100000, unit_price: 500 }], 500, 'efectivo')
    expect(r.ok).toBe(false)
    expect(r.shortfall?.length).toBeGreaterThan(0)
  })
})

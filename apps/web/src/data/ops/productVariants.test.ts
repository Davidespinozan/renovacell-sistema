// Agrupación producto→variantes (Opción A): una tarjeta por familia; variantes nunca sueltas.
import { describe, it, expect } from 'vitest'
import { catalogEntries, variantsOf, sellableVariantsOf, isVisualParent, isVariant, isSellableVariant } from './productVariants'
import type { ProductSafe } from '../types'

const mk = (o: Partial<ProductSafe>): ProductSafe => ({
  id: 'x', sku: 'X', name: 'X', line: 'prof', category: 'C', description: '', price: 100, unit: 'u',
  image_url: null, active: true, show_landing: true, show_portal: true, family: null, parent_product_id: null, sellable: true, ...o,
})
// Familia: padre (sellable=false, con imagen) + 3 variantes (2 con precio, 1 sin precio).
const parent = mk({ id: 'PAR', sku: 'HID-PAR', name: 'Hidrolizados', sellable: false, price: null, image_url: 'img://p', family: 'Hidrolizados' })
const v1 = mk({ id: 'v1', sku: 'HID-001', name: 'Hidrolizados Hueso', parent_product_id: 'PAR', price: 800, family: 'Hidrolizados' })
const v2 = mk({ id: 'v2', sku: 'HID-002', name: 'Hidrolizados Bazo', parent_product_id: 'PAR', price: 900, family: 'Hidrolizados' })
const v3 = mk({ id: 'v3', sku: 'HID-003', name: 'Hidrolizados Timo', parent_product_id: 'PAR', price: null, sellable: false, family: 'Hidrolizados' }) // sin precio
const solo = mk({ id: 'S1', sku: 'SER-001', name: 'Golden Serum', price: 2400 }) // standalone
const all = [parent, v1, v2, v3, solo]

describe('helpers de variantes', () => {
  it('isVariant / isVisualParent', () => {
    expect(isVariant(v1)).toBe(true); expect(isVariant(solo)).toBe(false)
    expect(isVisualParent(parent, all)).toBe(true); expect(isVisualParent(solo, all)).toBe(false)
  })
  it('variantsOf incluye todas; sellableVariantsOf solo con precio', () => {
    expect(variantsOf('PAR', all).map((v) => v.id)).toEqual(['v1', 'v2', 'v3'])
    expect(sellableVariantsOf('PAR', all).map((v) => v.id)).toEqual(['v1', 'v2'])
  })
  it('isSellableVariant: precio>0 y sellable!==false', () => {
    expect(isSellableVariant(v1)).toBe(true)
    expect(isSellableVariant(v3)).toBe(false)   // price null
    expect(isSellableVariant(parent)).toBe(false) // sellable false + price null
  })
})

describe('catalogEntries — agrupa producto/familia', () => {
  it('devuelve 1 familia (con 3 variantes) + 1 standalone; NINGUNA variante suelta', () => {
    const e = catalogEntries(all)
    expect(e.length).toBe(2)
    const fam = e.find((x) => x.kind === 'family')!
    expect(fam.product.id).toBe('PAR'); expect(fam.variants.map((v) => v.id)).toEqual(['v1', 'v2', 'v3'])
    const prod = e.find((x) => x.kind === 'product')!
    expect(prod.product.id).toBe('S1')
    // ninguna entry top-level es una variante
    expect(e.some((x) => x.product.parent_product_id)).toBe(false)
  })
  it('la variante sin precio se conserva en la familia (visible como "No disponible")', () => {
    const e = catalogEntries(all)
    const fam = e.find((x) => x.kind === 'family')!
    expect(fam.variants.some((v) => v.id === 'v3')).toBe(true)
    expect(fam.variants.filter(isSellableVariant).length).toBe(2)
  })
  it('keep filtra padres/standalone; keepVariant filtra variantes', () => {
    // Excluir la línea cosm no aplica aquí; probamos que un keep vacío deja fuera todo standalone
    const e = catalogEntries(all, (p) => p.line === 'prof', (v) => v.line === 'prof')
    expect(e.length).toBe(2) // familia + solo (ambos prof)
  })
  it('padre cuyas variantes NO pasan el filtro → no aparece', () => {
    const e = catalogEntries(all, () => true, () => false) // ninguna variante pasa
    // solo queda el standalone; la familia se omite por 0 variantes visibles
    expect(e.map((x) => x.product.id)).toEqual(['S1'])
  })
  it('parent huérfano (sellable=false, sin hijos) NO se muestra como standalone', () => {
    const orphan = mk({ id: 'ORPH', sku: 'NEW-001', name: 'DYSPORT', sellable: false, price: null })
    const e = catalogEntries([orphan, solo])
    expect(e.map((x) => x.product.id)).toEqual(['S1']) // el huérfano se omite
  })
})

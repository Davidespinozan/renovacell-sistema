import { describe, it, expect } from 'vitest'
import { volumeTiers, bestVolumeRule, effectiveUnitPrice, tierDiscountPct, volumeSavings, volumePromoLabel, nivelVolumen, etiquetaNivel, type VolumeRule } from './volumePricing'

const rules: VolumeRule[] = [
  { product_id: 'X', min_quantity: 5, price: 4370, active: true },
  { product_id: 'X', min_quantity: 10, price: 4100, active: true },
  { product_id: 'X', min_quantity: 20, price: 3900, active: false }, // inactiva
  { product_id: 'Y', min_quantity: 5, price: 900, active: true },
]

describe('volumePricing — previsualización (espeja precio_de LEAST)', () => {
  it('bestVolumeRule elige el tier correcto por cantidad', () => {
    expect(bestVolumeRule(rules, 'X', 1)).toBeNull()
    expect(bestVolumeRule(rules, 'X', 4)).toBeNull()
    expect(bestVolumeRule(rules, 'X', 5)?.min_quantity).toBe(5)
    expect(bestVolumeRule(rules, 'X', 9)?.min_quantity).toBe(5)
    expect(bestVolumeRule(rules, 'X', 10)?.min_quantity).toBe(10)
    expect(bestVolumeRule(rules, 'X', 25)?.min_quantity).toBe(10) // 20 está inactiva
  })
  it('SKUs distintos NO acumulan (Y no usa reglas de X)', () => {
    expect(bestVolumeRule(rules, 'Y', 5)?.price).toBe(900)
    expect(bestVolumeRule(rules, 'Y', 4)).toBeNull()
  })
  it('effectiveUnitPrice = LEAST(base, volumen)', () => {
    expect(effectiveUnitPrice(4600, rules, 'X', 1)).toBe(4600)   // sin tier → base
    expect(effectiveUnitPrice(4600, rules, 'X', 5)).toBe(4370)   // tier 5
    expect(effectiveUnitPrice(4600, rules, 'X', 10)).toBe(4100)  // tier 10
    expect(effectiveUnitPrice(4000, rules, 'X', 10)).toBe(4000)  // base ya menor → LEAST base
  })
  it('ignora tiers inactivos', () => {
    expect(effectiveUnitPrice(4600, rules, 'X', 20)).toBe(4100)  // 20 inactiva → usa 10
  })
  it('tierDiscountPct calcula el % correcto', () => {
    expect(tierDiscountPct(4600, 4370)).toBe(5)
    expect(tierDiscountPct(4600, 4600)).toBeNull()
    expect(tierDiscountPct(null, 100)).toBeNull()
  })
  it('volumeSavings = ahorro total por cantidad', () => {
    expect(volumeSavings(1000, [{ product_id: 'Z', min_quantity: 10, price: 900, active: true }], 'Z', 10)).toBe(1000)
    expect(volumeSavings(1000, [], 'Z', 10)).toBe(0)
  })
  it('volumeTiers ordena ascendente y solo activos', () => {
    expect(volumeTiers(rules, 'X').map((t) => t.min_quantity)).toEqual([5, 10])
  })
  it('volumePromoLabel arma la etiqueta del primer tier', () => {
    expect(volumePromoLabel(4600, rules, 'X')).toBe('Medio mayoreo desde 5 pzas · Mayoreo desde 10 $4,100')
    expect(volumePromoLabel(1000, rules, 'Y')).toBe('10% menos desde 5 pzas')
    expect(volumePromoLabel(1000, [], 'X')).toBeNull()
  })
})

describe('mayoreo y medio mayoreo (hoja oct 2026)', () => {
  const r: VolumeRule[] = [
    { product_id: 'N', min_quantity: 10, price: 1170, active: true },   // medio mayoreo
    { product_id: 'N', min_quantity: 50, price: 800, active: true },    // mayoreo
  ]
  it('nombra los niveles y dice cuánto falta para el siguiente', () => {
    expect(nivelVolumen(1300, r, 'N', 3)).toEqual({ actual: null, siguiente: { nombre: 'Medio mayoreo', faltan: 7, precio: 1170 } })
    expect(nivelVolumen(1300, r, 'N', 12).actual).toEqual({ nombre: 'Medio mayoreo', precio: 1170 })
    expect(nivelVolumen(1300, r, 'N', 50)).toEqual({ actual: { nombre: 'Mayoreo', precio: 800 }, siguiente: null })
    expect(effectiveUnitPrice(1300, r, 'N', 50)).toBe(800)
  })
  it('etiquetas: lejos del siguiente nivel no estorba; cerca, empuja', () => {
    expect(etiquetaNivel(1300, r, 'N', 1)).toBeNull()
    expect(etiquetaNivel(1300, r, 'N', 8)).toBe('Faltan 2 para medio mayoreo ($1,170 c/u)')
    expect(etiquetaNivel(1300, r, 'N', 12)).toBe('Precio de medio mayoreo')
    expect(etiquetaNivel(1300, r, 'N', 30)).toBe('Precio de medio mayoreo')
    expect(etiquetaNivel(1300, r, 'N', 40)).toBe('Faltan 10 para mayoreo ($800 c/u)')
    expect(etiquetaNivel(1300, r, 'N', 60)).toBe('Precio de mayoreo')
  })
  it('el catálogo anuncia los dos niveles', () => {
    expect(volumePromoLabel(1300, r, 'N')).toBe('Medio mayoreo desde 10 pzas · Mayoreo desde 50 $800')
  })
})

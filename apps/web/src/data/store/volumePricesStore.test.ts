// DESCUENTOS POR CANTIDAD — CRUD admin en modo mock + validaciones. El cobro real lo
// decide el servidor (precio_de); aquí se prueba la administración de reglas.
import { describe, it, expect, beforeEach } from 'vitest'
import { createVolumeRule, updateVolumeRule, setVolumeActive, deleteVolumeRule, getVolumeRules } from './volumePricesStore'

const rulesOf = (pid: string) => getVolumeRules().filter((r) => r.product_id === pid)

describe('volumePricesStore — CRUD por SKU (mock)', () => {
  it('crea una regla válida', () => {
    const r = createVolumeRule({ product_id: 'P1', min_quantity: 5, price: 4370 })
    expect(r.ok).toBe(true)
    expect(rulesOf('P1').some((x) => x.min_quantity === 5 && x.price === 4370 && x.active)).toBe(true)
  })
  it('rechaza min_quantity < 2', () => {
    expect(createVolumeRule({ product_id: 'P2', min_quantity: 1, price: 100 }).ok).toBe(false)
  })
  it('rechaza precio <= 0', () => {
    expect(createVolumeRule({ product_id: 'P2', min_quantity: 5, price: 0 }).ok).toBe(false)
  })
  it('rechaza threshold duplicado para el MISMO producto', () => {
    createVolumeRule({ product_id: 'P3', min_quantity: 5, price: 900 })
    const dup = createVolumeRule({ product_id: 'P3', min_quantity: 5, price: 800 })
    expect(dup.ok).toBe(false)
    expect(rulesOf('P3').filter((r) => r.min_quantity === 5).length).toBe(1)
  })
  it('permite múltiples thresholds distintos por SKU', () => {
    createVolumeRule({ product_id: 'P4', min_quantity: 5, price: 900 })
    createVolumeRule({ product_id: 'P4', min_quantity: 10, price: 850 })
    expect(rulesOf('P4').map((r) => r.min_quantity).sort((a, b) => a - b)).toEqual([5, 10])
  })
  it('SKUs distintos no se afectan entre sí', () => {
    createVolumeRule({ product_id: 'A', min_quantity: 5, price: 500 })
    createVolumeRule({ product_id: 'B', min_quantity: 5, price: 600 })
    expect(rulesOf('A').length).toBe(1)
    expect(rulesOf('B')[0].price).toBe(600)
  })
  it('edita (con validación de duplicado)', () => {
    const r = createVolumeRule({ product_id: 'E1', min_quantity: 5, price: 900 })
    const up = updateVolumeRule(r.id!, { price: 880 })
    expect(up.ok).toBe(true)
    expect(rulesOf('E1')[0].price).toBe(880)
  })
  it('activa/desactiva', () => {
    const r = createVolumeRule({ product_id: 'T1', min_quantity: 5, price: 900 })
    setVolumeActive(r.id!, false)
    expect(rulesOf('T1')[0].active).toBe(false)
    setVolumeActive(r.id!, true)
    expect(rulesOf('T1')[0].active).toBe(true)
  })
  it('elimina', () => {
    const r = createVolumeRule({ product_id: 'D1', min_quantity: 5, price: 900 })
    deleteVolumeRule(r.id!)
    expect(rulesOf('D1').length).toBe(0)
  })
})

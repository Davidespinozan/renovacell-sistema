// AVISO DE AHORRO (2 nov 2026) · cuántas piezas faltan para el siguiente nivel, a qué precio y cuánto se ahorra en total,
// con las reglas del pedido (el medio de 10 se junta; uno en mayoreo baja todo).
import { describe, it, expect } from 'vitest'
import { oportunidadesVolumen, textoOportunidad, type VolumeRule } from './volumePricing'

const R = (product_id: string, min_quantity: number, price: number, nivel: 'medio' | 'mayoreo'): VolumeRule => ({ product_id, min_quantity, price, nivel, active: true })
const reglas = [R('A', 10, 900, 'medio'), R('A', 50, 800, 'mayoreo'), R('B', 10, 450, 'medio'), R('B', 30, 400, 'mayoreo')]

describe('oportunidadesVolumen', () => {
  it('7 piezas: faltan 3 para medio mayoreo y ahorra (1000−900)×10', () => {
    const [o] = oportunidadesVolumen([{ product_id: 'A', qty: 7, base: 1000 }], reglas)
    expect(o).toMatchObject({ product_id: 'A', faltan: 3, nivel: 'Medio mayoreo', precioAhora: 1000, precioNuevo: 900, ahorro: 1000, arrastra: false })
    expect(textoOportunidad(o, 'Golden')).toBe('Agrega 3 piezas más de Golden y pagas $900 c/u (medio mayoreo) en vez de $1,000: ahorras $1,000.')
    expect(textoOportunidad(o, 'Golden', 'vendedor')).toMatch(/^Ofrécele 3 piezas más de Golden y paga \$900/)
  })
  it('juntando piezas: 6 de A + 3 de B → 1 más de cualquiera baja los dos a medio mayoreo', () => {
    const ops = oportunidadesVolumen([{ product_id: 'A', qty: 6, base: 1000 }, { product_id: 'B', qty: 3, base: 500 }], reglas)
    const a = ops.find((x) => x.product_id === 'A')!
    expect(a.faltan).toBe(1)
    expect(a.arrastra).toBe(true)
    expect(a.ahorro).toBe(7 * 100 + 3 * 50)
  })
  it('ya en medio mayoreo: siguiente es mayoreo y su ahorro arrastra a todo el pedido', () => {
    const ops = oportunidadesVolumen([{ product_id: 'A', qty: 12, base: 1000 }, { product_id: 'B', qty: 25, base: 500 }], reglas)
    const b = ops.find((x) => x.product_id === 'B')!
    expect(b).toMatchObject({ faltan: 5, nivel: 'Mayoreo', precioNuevo: 400, arrastra: true })
    expect(b.ahorro).toBe(30 * 50 + 12 * 100)   // B baja 50 c/u y, por la regla del pedido, A pasa a su mayoreo (900 → 800)
  })
  it('sin escalones o ya en el último nivel: sin aviso', () => {
    expect(oportunidadesVolumen([{ product_id: 'C', qty: 3, base: 100 }], reglas)).toEqual([])
    expect(oportunidadesVolumen([{ product_id: 'A', qty: 60, base: 1000 }], reglas)).toEqual([])
  })
})

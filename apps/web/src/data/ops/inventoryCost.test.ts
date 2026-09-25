import { describe, it, expect } from 'vitest'
import { blendedLotCost, movementEntryCost } from './inventoryCost'

describe('blendedLotCost — política de costo de adquisición (no fabrica costo)', () => {
  it('lote nuevo / sin existencia previa → toma el costo entrante', () => {
    expect(blendedLotCost(0, null, 10, 1000)).toBe(1000)
    expect(blendedLotCost(0, 900, 10, 1000)).toBe(1000) // sin unidades previas, el viejo no pesa
  })
  it('ambos conocidos → promedio ponderado', () => {
    // 10 @ 900 + 10 @ 1000 = 950
    expect(blendedLotCost(10, 900, 10, 1000)).toBe(950)
    // 5 @ 900 + 15 @ 1000 = 975
    expect(blendedLotCost(5, 900, 15, 1000)).toBe(975)
  })
  it('entrante desconocido (NULL) → el costo conocido del lote NO cambia', () => {
    expect(blendedLotCost(10, 900, 10, null)).toBe(900)
    expect(blendedLotCost(10, null, 10, null)).toBeNull()
  })
  it('previo desconocido con existencia + entrante conocido → NULL (no fabrica)', () => {
    expect(blendedLotCost(10, null, 10, 1000)).toBeNull()
  })
  it('redondea a 4 decimales', () => {
    expect(blendedLotCost(3, 100, 1, 101)).toBe(100.25)
  })
})

describe('movementEntryCost — costo congelado del movimiento de entrada', () => {
  it('es el costo entrante (o NULL)', () => {
    expect(movementEntryCost(1000)).toBe(1000)
    expect(movementEntryCost(null)).toBeNull()
    expect(movementEntryCost(undefined)).toBeNull()
  })
})

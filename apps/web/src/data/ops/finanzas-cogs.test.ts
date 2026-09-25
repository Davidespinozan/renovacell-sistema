// Fase 2 · COGS a partir de snapshots congelados en el ledger (no retroactivo) + cobertura.
import { describe, it, expect } from 'vitest'
import { estadoResultados } from './finanzas'
import type { InventoryMovement } from '../types'

const mov = (o: Partial<InventoryMovement>): InventoryMovement => ({
  id: Math.random().toString(36).slice(2), lot_id: 'L', change: -1, reason: 'venta',
  reference: 'F1', created_by: null, created_at: '2026-09-25T10:00:00Z', unit_cost: null, ...o,
})

describe('estadoResultados — COGS usa movement.unit_cost (congelado)', () => {
  it('COGS = suma de |change|·unit_cost del movimiento (no del costo actual del lote)', () => {
    const movements = [mov({ change: -10, reason: 'venta', unit_cost: 900 })]
    // lots con OTRO unit_cost: NO debe influir (la historia usa el snapshot del movimiento).
    const lots = [{ id: 'L', product_id: 'P', lot_code: 'L', manufacture_date: null, expiry_date: null, quantity: 0, location: null, unit_cost: 5000, metadata: null }]
    const er = estadoResultados([], [], movements, lots as never)
    expect(er.costoVentas).toBe(9000)
    expect(er.costoConfiable).toBe(true)
    expect(er.costoConocidoPct).toBe(100)
    expect(er.unidadesSinCosto).toBe(0)
  })
  it('multi-lote: 5@900 + 5@1000 → COGS 9500 (snapshots separados)', () => {
    const movements = [
      mov({ change: -5, reason: 'venta', unit_cost: 900 }),
      mov({ change: -5, reason: 'venta', unit_cost: 1000 }),
    ]
    expect(estadoResultados([], [], movements, []).costoVentas).toBe(9500)
  })
  it('unit_cost NULL (legacy) → NO se cuenta como 0; se marca cobertura incompleta', () => {
    const movements = [
      mov({ change: -8, reason: 'venta', unit_cost: 900 }),   // conocido
      mov({ change: -2, reason: 'venta', unit_cost: null }),  // desconocido (legacy)
    ]
    const er = estadoResultados([], [], movements, [])
    expect(er.costoVentas).toBe(7200)          // solo lo conocido (8·900), NULL no suma 0 fabricado
    expect(er.unidadesSinCosto).toBe(2)
    expect(er.costoConfiable).toBe(false)
    expect(er.costoConocidoPct).toBe(80)       // 8 de 10 unidades con costo
  })
  it('mermas usan costo congelado; NULL no se contabiliza (desconocido)', () => {
    const movements = [
      mov({ change: -3, reason: 'merma', unit_cost: 100 }),
      mov({ change: -1, reason: 'merma', unit_cost: null }),
    ]
    expect(estadoResultados([], [], movements, []).mermas).toBe(300) // 3·100; el NULL no fabrica
  })
  it('entradas/inflows no cuentan como COGS de venta', () => {
    const movements = [mov({ change: 20, reason: 'entrada', unit_cost: 900 })]
    const er = estadoResultados([], [], movements, [])
    expect(er.costoVentas).toBe(0)
    expect(er.costoConfiable).toBe(true) // sin unidades de COGS → cobertura 100 por definición
  })
})

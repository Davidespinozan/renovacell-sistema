// Casos adicionales de finanzas: reversas de costo, arqueo sin filtro.
import { describe, it, expect } from 'vitest'
import { estadoResultados, efectivoEsperado, cuentasPorCobrar } from './finanzas'
import { mkOrder, mkLot, mkMov } from '../../test/factories'

describe('estadoResultados — reversas y márgenes', () => {
  it('una cancelación (reingreso) resta del costo de ventas', () => {
    const lots = [mkLot({ id: 'l1', unit_cost: 100, quantity: 10 })]
    const movements = [
      mkMov({ lot_id: 'l1', change: -5, reason: 'surtido' }), // -500 costo
      mkMov({ lot_id: 'l1', change: 2, reason: 'cancelacion' }), // reingreso: +2*100 revierte
    ]
    const r = estadoResultados([mkOrder({ total: 2000 })], [], movements, lots)
    expect(r.costoVentas).toBe(300) // 500 - 200
  })

  it('sin ventas ni movimientos, márgenes en 0', () => {
    const r = estadoResultados([], [], [], [])
    expect(r).toMatchObject({ ventas: 0, costoVentas: 0, margenBruto: 0, margenNeto: 0 })
  })

  it('los gastos reducen la utilidad neta pero no la bruta', () => {
    const lots = [mkLot({ id: 'l1', unit_cost: 100 })]
    const movements = [mkMov({ lot_id: 'l1', change: -1, reason: 'surtido' })]
    const r = estadoResultados([mkOrder({ total: 1000 })], [{ id: 'g', fecha: '2026-06-01', categoria: 'Renta', concepto: 'x', monto: 400, created_at: '' } as never], movements, lots)
    expect(r.utilidadBruta).toBe(900) // 1000 - 100
    expect(r.utilidadNeta).toBe(500) // 900 - 400 gastos
  })
})

describe('efectivoEsperado — sin filtro', () => {
  it('suma todas las ventas POS en efectivo cuando no se filtra', () => {
    const r = efectivoEsperado([
      mkOrder({ id: '1', external_ref: 'POS-1', payment_method: 'efectivo', total: 100 }),
      mkOrder({ id: '2', external_ref: 'POS-2', payment_method: 'efectivo', total: 200 }),
      mkOrder({ id: '3', external_ref: 'S-1', payment_method: 'efectivo', total: 999 }), // no POS
    ], {})
    expect(r).toBe(300)
  })
})

describe('cuentasPorCobrar — más casos', () => {
  it('sin pedidos, total 0', () => {
    expect(cuentasPorCobrar([])).toEqual({ total: 0, count: 0 })
  })
})

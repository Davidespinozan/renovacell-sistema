// Casos límite adicionales de existencias y FEFO.
import { describe, it, expect } from 'vitest'
import { stockByProduct, stockInfoFor, LOW_STOCK } from './stock'
import { allocateFEFO } from './surtir'
import { mkLot } from '../../test/factories'

describe('stockByProduct — límites de estado', () => {
  it('justo por encima del umbral es "ok"', () => {
    const map = stockByProduct([mkLot({ product_id: 'p', quantity: LOW_STOCK + 1 })])
    expect(map['p'].status).toBe('ok')
  })
  it('un producto con TODO caducado queda tracked pero en 0 (out)', () => {
    const map = stockByProduct([mkLot({ product_id: 'p', quantity: 50, expiry_date: '2000-01-01' })])
    expect(map['p'].tracked).toBe(true)
    expect(map['p'].qty).toBe(0)
    expect(map['p'].status).toBe('out')
  })
  it('suma varios lotes vigentes del mismo producto', () => {
    const map = stockByProduct([
      mkLot({ id: 'a', product_id: 'p', quantity: 5 }),
      mkLot({ id: 'b', product_id: 'p', quantity: 7 }),
    ])
    expect(map['p'].qty).toBe(12)
  })
  it('sin fecha de caducidad, el lote cuenta', () => {
    const map = stockByProduct([mkLot({ product_id: 'p', quantity: 3, expiry_date: null })])
    expect(map['p'].qty).toBe(3)
  })
})

describe('stockInfoFor', () => {
  it('devuelve la info del producto si existe', () => {
    const map = stockByProduct([mkLot({ product_id: 'p', quantity: 4 })])
    expect(stockInfoFor(map, 'p').qty).toBe(4)
  })
})

describe('allocateFEFO — más casos', () => {
  it('pedir 0 no asigna nada', () => {
    const r = allocateFEFO('p1', 0, [mkLot({ quantity: 10 })])
    expect(r.allocations).toHaveLength(0)
    expect(r.shortfall).toBe(0)
  })
  it('sin lotes del producto = todo faltante', () => {
    const r = allocateFEFO('p1', 5, [mkLot({ product_id: 'otro', quantity: 10 })])
    expect(r.shortfall).toBe(5)
  })
  it('lote sin fecha va al final del orden FEFO', () => {
    const lots = [
      mkLot({ id: 'sinfecha', expiry_date: null, quantity: 10 }),
      mkLot({ id: 'confecha', expiry_date: '2027-01-01', quantity: 3 }),
    ]
    const r = allocateFEFO('p1', 4, lots)
    expect(r.allocations[0].lot.id).toBe('confecha') // el que caduca primero
  })
  it('toma exactamente lo necesario del primer lote', () => {
    const r = allocateFEFO('p1', 2, [mkLot({ id: 'a', quantity: 10, expiry_date: '2027-01-01' })])
    expect(r.allocations[0].qty).toBe(2)
    expect(r.shortfall).toBe(0)
  })
})

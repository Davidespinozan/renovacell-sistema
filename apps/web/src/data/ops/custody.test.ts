// W2-C · La disponibilidad manda en el frontend. El caso del dueño: 10 propias,
// 7 en custodia, 3 disponibles — y nadie puede asignar la cuarta.
import { describe, it, expect } from 'vitest'
import { allocateFEFO, planSurtido, disponibleDeLote, type EnCustodia } from './surtir'
import { disponiblePorProducto, lotesDisponibles, saldoPorProducto, custodiaAbiertaDe, saldoDe } from '../store/custodyStore'
import type { StockDisponible, CustodyStock, Custody } from './custody'
import type { Lot } from '../types'
import type { OrderWithItems } from '../store/ordersStore'

const lote = (p: Partial<Lot> & { id: string; product_id: string; quantity: number }): Lot => ({
  lot_code: 'L-' + p.id, expiry_date: '2027-01-01', location: 'A', unit_cost: 10,
  created_at: '2026-01-01T00:00:00Z', ...p,
} as Lot)

const PROD = 'prod-1'
const LOTE = lote({ id: 'lot-1', product_id: PROD, quantity: 10 })
const CUSTODIA: EnCustodia = { 'lot-1': 7 }

describe('disponibilidad por lote: propio − en custodia', () => {
  it('10 propias con 7 en custodia dejan 3 disponibles', () => {
    expect(disponibleDeLote(LOTE, CUSTODIA)).toBe(3)
  })
  it('sin custodia, disponible = propio (comportamiento de siempre)', () => {
    expect(disponibleDeLote(LOTE)).toBe(10)
  })
  it('nunca da un número negativo', () => {
    expect(disponibleDeLote(LOTE, { 'lot-1': 99 })).toBe(0)
  })
})

describe('POS y Surtido asignan MÁXIMO lo disponible', () => {
  it('pedir 3 se asigna completo', () => {
    const r = allocateFEFO(PROD, 3, [LOTE], CUSTODIA)
    expect(r.shortfall).toBe(0)
    expect(r.allocations).toEqual([{ lot: LOTE, qty: 3 }])
  })
  it('pedir 4 deja faltante: la cuarta unidad está en custodia', () => {
    const r = allocateFEFO(PROD, 4, [LOTE], CUSTODIA)
    expect(r.shortfall).toBe(1)
    expect(r.allocations.reduce((s, a) => s + a.qty, 0)).toBe(3)
  })
  it('pedir 10 solo asigna 3, no la existencia propia', () => {
    const r = allocateFEFO(PROD, 10, [LOTE], CUSTODIA)
    expect(r.allocations.reduce((s, a) => s + a.qty, 0)).toBe(3)
    expect(r.shortfall).toBe(7)
  })
  it('no asigna un lote CADUCADO aunque tenga disponibilidad', () => {
    const viejo = lote({ id: 'lot-2', product_id: PROD, quantity: 5, expiry_date: '2020-01-01' })
    expect(allocateFEFO(PROD, 1, [viejo]).shortfall).toBe(1)
  })
  it('respeta FEFO entre lotes, descontando la custodia de cada uno', () => {
    const a = lote({ id: 'lot-a', product_id: PROD, quantity: 5, expiry_date: '2027-06-01' })
    const b = lote({ id: 'lot-b', product_id: PROD, quantity: 5, expiry_date: '2027-12-01' })
    const r = allocateFEFO(PROD, 6, [b, a], { 'lot-a': 4 })
    expect(r.allocations.map((x) => [x.lot.id, x.qty])).toEqual([['lot-a', 1], ['lot-b', 5]])
    expect(r.shortfall).toBe(0)
  })
  it('el surtido de un pedido también topa en lo disponible', () => {
    const order = { id: 'o1', items: [{ id: 'i1', product_id: PROD, qty: 4 }] } as unknown as OrderWithItems
    const plans = planSurtido(order, [LOTE], CUSTODIA)
    expect(plans[0].shortfall).toBe(1)
    const sinCustodia = planSurtido(order, [LOTE])
    expect(sinCustodia[0].shortfall).toBe(0)
  })
})

describe('lo que el catálogo promete sale de la vista del servidor', () => {
  const rows: StockDisponible[] = [
    { lot_id: 'lot-1', product_id: PROD, lot_code: 'L1', expiry_date: '2027-01-01', location: 'A', propio: 10, en_custodia: 7, disponible: 3, caducado: false },
    { lot_id: 'lot-2', product_id: PROD, lot_code: 'L2', expiry_date: '2020-01-01', location: 'A', propio: 5, en_custodia: 0, disponible: 5, caducado: true },
    { lot_id: 'lot-3', product_id: 'prod-2', lot_code: 'L3', expiry_date: null, location: 'A', propio: 4, en_custodia: 4, disponible: 0, caducado: false },
  ]
  it('promete 3 del producto con 7 en custodia, y nada caducado', () => {
    expect(disponiblePorProducto(rows)[PROD]).toBe(3)
  })
  it('un producto totalmente en custodia se ofrece en 0', () => {
    expect(disponiblePorProducto(rows)['prod-2']).toBe(0)
  })
  it('solo se listan lotes con disponibilidad y vigentes, en orden FEFO', () => {
    expect(lotesDisponibles(rows, PROD).map((l) => l.lot_id)).toEqual(['lot-1'])
    expect(lotesDisponibles(rows, 'prod-2')).toEqual([])
  })
})

describe('el saldo del tenedor sale del libro, no de un contador', () => {
  const stock: CustodyStock[] = [
    { custody_id: 'c1', product_id: PROD, lot_id: 'lot-1', entregado: 10, vendido: 2, devuelto: 1, perdido: 0, en_poder: 7 },
    { custody_id: 'c1', product_id: PROD, lot_id: 'lot-2', entregado: 4, vendido: 4, devuelto: 0, perdido: 0, en_poder: 0 },
    { custody_id: 'c2', product_id: PROD, lot_id: 'lot-3', entregado: 3, vendido: 0, devuelto: 0, perdido: 0, en_poder: 3 },
  ]
  it('agrega por producto solo lo que sigue en poder', () => {
    expect(saldoPorProducto(stock, 'c1')[PROD]).toBe(7)
  })
  it('no mezcla el saldo de dos custodias', () => {
    expect(saldoPorProducto(stock, 'c2')[PROD]).toBe(3)
  })
  it('las filas agotadas no aparecen como saldo vivo', () => {
    expect(saldoDe(stock, 'c1').map((s) => s.lot_id)).toEqual(['lot-1'])
  })
  it('encuentra la custodia ABIERTA del tenedor, no una cerrada', () => {
    const cs = [
      { id: 'c0', kind: 'vendedor', status: 'cerrada', holder_user_id: 'u1' },
      { id: 'c1', kind: 'vendedor', status: 'abierta', holder_user_id: 'u1' },
      { id: 'c2', kind: 'vendedor', status: 'abierta', holder_user_id: 'u2' },
    ] as unknown as Custody[]
    expect(custodiaAbiertaDe(cs, 'u1')?.id).toBe('c1')
    expect(custodiaAbiertaDe(cs, 'u3')).toBeNull()
  })
})

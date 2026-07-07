// Pruebas de la lógica de negocio CRÍTICA (funciones puras): surtido FEFO,
// existencias y estado de resultados. Protegen contra regresiones al seguir
// desarrollando. Ejecuta: `npm test`.
import { describe, it, expect } from 'vitest'
import { allocateFEFO } from './surtir'
import { stockByProduct, stockInfoFor, LOW_STOCK } from './stock'
import { estadoResultados } from './finanzas'
import type { Lot, InventoryMovement } from '../types'
import type { OrderWithItems } from '../hooks/useOrders'

// Fechas fijas relativas a hoy (para caducados/vigentes deterministas).
const today = new Date().toISOString().slice(0, 10)
const future = '2099-12-31'
const past = '2000-01-01'

const lot = (over: Partial<Lot>): Lot => ({
  id: 'l1', product_id: 'p1', lot_code: 'L-1', manufacture_date: null,
  expiry_date: future, quantity: 10, location: null, unit_cost: 0, metadata: null, ...over,
})

describe('allocateFEFO — surtido first-expired-first-out', () => {
  it('asigna primero el lote que caduca antes', () => {
    const lots = [
      lot({ id: 'a', expiry_date: '2030-01-01', quantity: 5 }),
      lot({ id: 'b', expiry_date: '2027-01-01', quantity: 5 }),
    ]
    const { allocations, shortfall } = allocateFEFO('p1', 4, lots)
    expect(shortfall).toBe(0)
    expect(allocations[0].lot.id).toBe('b') // el que caduca antes
    expect(allocations[0].qty).toBe(4)
  })

  it('reparte entre varios lotes cuando uno no alcanza', () => {
    const lots = [
      lot({ id: 'a', expiry_date: '2027-01-01', quantity: 3 }),
      lot({ id: 'b', expiry_date: '2030-01-01', quantity: 10 }),
    ]
    const { allocations, shortfall } = allocateFEFO('p1', 8, lots)
    expect(shortfall).toBe(0)
    expect(allocations.map((a) => [a.lot.id, a.qty])).toEqual([['a', 3], ['b', 5]])
  })

  it('NUNCA surte de un lote caducado (regulado) y reporta faltante', () => {
    const lots = [
      lot({ id: 'venc', expiry_date: past, quantity: 100 }),
      lot({ id: 'ok', expiry_date: future, quantity: 2 }),
    ]
    const { allocations, shortfall } = allocateFEFO('p1', 5, lots)
    expect(allocations.every((a) => a.lot.id !== 'venc')).toBe(true)
    expect(allocations.reduce((s, a) => s + a.qty, 0)).toBe(2)
    expect(shortfall).toBe(3)
  })

  it('ignora lotes de otro producto y sin existencia', () => {
    const lots = [
      lot({ id: 'otro', product_id: 'p2', quantity: 50 }),
      lot({ id: 'vacio', quantity: 0 }),
      lot({ id: 'ok', quantity: 4 }),
    ]
    const { allocations, shortfall } = allocateFEFO('p1', 4, lots)
    expect(allocations).toHaveLength(1)
    expect(allocations[0].lot.id).toBe('ok')
    expect(shortfall).toBe(0)
  })
})

describe('stockByProduct — existencias tipo tienda', () => {
  it('excluye caducados y suma vigentes', () => {
    const lots = [
      lot({ id: 'a', product_id: 'p1', quantity: 30, expiry_date: future }),
      lot({ id: 'b', product_id: 'p1', quantity: 100, expiry_date: past }), // caducado: no cuenta
    ]
    const map = stockByProduct(lots)
    expect(map['p1'].qty).toBe(30)
    expect(map['p1'].status).toBe('ok')
  })

  it('marca "low" en el umbral y "out" en cero', () => {
    const map = stockByProduct([
      lot({ id: 'a', product_id: 'low', quantity: LOW_STOCK }),
      lot({ id: 'b', product_id: 'out', quantity: 0 }),
    ])
    expect(map['low'].status).toBe('low')
    expect(map['out'].status).toBe('out')
  })

  it('stockInfoFor devuelve "untracked" para un producto sin lotes', () => {
    const info = stockInfoFor({}, 'desconocido')
    expect(info.tracked).toBe(false)
    expect(info.status).toBe('untracked')
    expect(info.qty).toBe(0)
  })
})

describe('estadoResultados — utilidad valuada al costo REAL del lote', () => {
  const order = (over: Partial<OrderWithItems>): OrderWithItems => ({
    id: 'o1', external_ref: 'S1', doctor_id: 'd1', total: 1000, currency: 'MXN',
    status: 'delivered', payment_method: 'contra_pedido', payment_ref: null,
    payment_status: 'paid', stripe_payment_id: null, invoice_requested: false,
    invoice_meta: null, shipping_meta: null, created_at: `${today}T10:00:00Z`, items: [], ...over,
  })
  const mov = (over: Partial<InventoryMovement>): InventoryMovement => ({
    id: 'm1', lot_id: 'l1', change: -1, reason: 'surtido', reference: 'S1',
    created_by: null, created_at: `${today}T10:00:00Z`, ...over,
  })

  it('usa el unit_cost del lote como costo de ventas (no margen 100% falso)', () => {
    const lots = [lot({ id: 'l1', unit_cost: 400, quantity: 10 })]
    const orders = [order({ total: 1000 })]
    const movements = [mov({ lot_id: 'l1', change: -2, reason: 'surtido' })] // 2 u vendidas
    const r = estadoResultados(orders, [], movements, lots)
    expect(r.ventas).toBe(1000)
    expect(r.costoVentas).toBe(800)       // 2 × 400 (costo real)
    expect(r.utilidadBruta).toBe(200)
    expect(r.margenBruto).toBeCloseTo(20) // NO 100%
  })

  it('separa la merma (caducidad/daño) del costo de ventas', () => {
    const lots = [lot({ id: 'l1', unit_cost: 100, quantity: 10 })]
    const movements = [
      mov({ lot_id: 'l1', change: -1, reason: 'surtido' }), // costo de ventas
      mov({ lot_id: 'l1', change: -3, reason: 'merma' }),   // pérdida, no COGS
    ]
    const r = estadoResultados([order({ total: 500 })], [], movements, lots)
    expect(r.costoVentas).toBe(100) // solo el surtido
    expect(r.mermas).toBe(300)      // 3 × 100
    expect(r.utilidadNeta).toBe(500 - 100 - 300)
  })

  it('un pedido pending_payment/cancelado no cuenta como venta', () => {
    const r = estadoResultados([order({ status: 'pending_payment', total: 9999 })], [], [], [])
    expect(r.ventas).toBe(0)
  })
})

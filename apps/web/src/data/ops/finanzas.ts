// Lógica PURA de finanzas (sin estado, fácil de testear) — estilo CuboPolar.
// Estado de resultados, posición financiera (CxC/CxP) y arqueo de caja.
// SENSIBLE: usa costos → solo se muestra a Dirección.
import type { OrderWithItems } from '../hooks/useOrders'
import { isSale, isPosOrder } from '../metrics'
import { costOf } from '../mock/costs'
import type { Gasto } from '../store/gastosStore'
import type { PurchaseOrder } from '../store/comprasStore'
import type { InventoryMovement, Lot } from '../types'

// Movimientos que representan COSTO de ventas (salidas vendidas) y sus reversas.
const COGS_OUT = new Set(['surtido', 'venta', 'evento'])
const COGS_IN = new Set(['cancelacion', 'evento-regreso'])

export interface EstadoResultados {
  ventas: number
  costoVentas: number
  utilidadBruta: number
  gastos: number
  utilidadNeta: number
  margenBruto: number   // %
  margenNeto: number    // %
}

// Estado de resultados del periodo: ventas − costo de ventas − gastos = utilidad.
// El COSTO DE VENTAS sale del LEDGER valuado al costo REAL de cada lote que salió
// (no un costo plano): trazabilidad de costo lote por lote.
export function estadoResultados(orders: OrderWithItems[], gastos: Gasto[], movements: InventoryMovement[], lots: Lot[]): EstadoResultados {
  const sales = orders.filter(isSale)
  const ventas = sales.reduce((s, o) => s + (o.total ?? 0), 0)
  const lotById: Record<string, Lot | undefined> = Object.fromEntries(lots.map((l) => [l.id, l]))
  const lotCost = (lotId: string): number => {
    const l = lotById[lotId]
    return l?.unit_cost ?? costOf(l?.product_id)
  }
  const costoVentas = movements.reduce((s, m) => {
    const c = lotCost(m.lot_id)
    if (COGS_OUT.has(m.reason ?? '') && m.change < 0) return s + (-m.change) * c
    if (COGS_IN.has(m.reason ?? '') && m.change > 0) return s - m.change * c
    return s
  }, 0)
  const gastosTotal = gastos.reduce((s, g) => s + g.monto, 0)
  const utilidadBruta = ventas - costoVentas
  const utilidadNeta = utilidadBruta - gastosTotal
  return {
    ventas,
    costoVentas,
    utilidadBruta,
    gastos: gastosTotal,
    utilidadNeta,
    margenBruto: ventas > 0 ? (utilidadBruta / ventas) * 100 : 0,
    margenNeto: ventas > 0 ? (utilidadNeta / ventas) * 100 : 0,
  }
}

// Cuentas por COBRAR: pedidos del Portal confirmados (contra pedido) que el
// cliente aún no paga — incluye los 'pending_payment' (contra pedido es un
// cobrable real). Excluye cancelados, borradores y POS (POS se cobra al momento).
export function cuentasPorCobrar(orders: OrderWithItems[]): { total: number; count: number } {
  const pend = orders.filter((o) =>
    !isPosOrder(o)
    && o.status !== 'cancelled' && o.status !== 'draft'
    && o.payment_status !== 'paid')
  return { total: pend.reduce((s, o) => s + (o.total ?? 0), 0), count: pend.length }
}

// Cuentas por PAGAR: compras a proveedor NO pagadas (pendientes o recibidas sin
// pagar), valoradas a su costo real de compra.
export function cuentasPorPagar(compras: PurchaseOrder[]): { total: number; count: number } {
  const pend = compras.filter((p) => p.kind === 'compra' && !p.paid)
  return { total: pend.reduce((s, p) => s + p.unit_cost * p.qty, 0), count: pend.length }
}

// Desglose de gastos por categoría (para gráfica/tabla).
export function gastosPorCategoria(gastos: Gasto[]): { categoria: string; monto: number }[] {
  const m: Record<string, number> = {}
  gastos.forEach((g) => { m[g.categoria] = (m[g.categoria] ?? 0) + g.monto })
  return Object.entries(m).map(([categoria, monto]) => ({ categoria, monto })).sort((a, b) => b.monto - a.monto)
}

// ---- Arqueo / cierre de caja (POS efectivo) -------------------------------
// Esperado = ventas POS en EFECTIVO dentro del alcance (día u evento).
export function efectivoEsperado(orders: OrderWithItems[], opts: { day?: string; eventId?: string }): number {
  return orders
    .filter((o) => isPosOrder(o) && (o.payment_method === 'efectivo'))
    .filter((o) => {
      const meta = (o.shipping_meta ?? {}) as { event_id?: string | null }
      if (opts.eventId) return meta.event_id === opts.eventId
      if (opts.day) return o.created_at.slice(0, 10) === opts.day
      return true
    })
    .reduce((s, o) => s + (o.total ?? 0), 0)
}

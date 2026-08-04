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
const COGS_OUT = new Set(['surtido', 'venta', 'evento', 'consigna'])
const COGS_IN = new Set(['cancelacion', 'evento-regreso', 'consigna-regreso'])
// Bajas de inventario que son PÉRDIDA (no costo de ventas): caducidad/daño.
const MERMA = new Set(['merma', 'baja'])

// Renglón mínimo de devolución que necesitan los reportes (evita acoplar a refundsStore).
export interface RefundLine { order_id: string; monto: number; metodo?: string | null }

export interface EstadoResultados {
  ventas: number        // ventas BRUTAS del periodo
  devoluciones: number  // devoluciones/correcciones de esos pedidos
  ventasNetas: number   // ventas − devoluciones (la base real del margen)
  costoVentas: number
  utilidadBruta: number
  gastos: number
  mermas: number        // pérdida por caducidad/daño (a costo)
  utilidadNeta: number
  margenBruto: number   // %
  margenNeto: number    // %
}

// Estado de resultados del periodo: ventas netas − costo de ventas − gastos = utilidad.
// El COSTO DE VENTAS sale del LEDGER valuado al costo REAL de cada lote que salió
// (no un costo plano): trazabilidad de costo lote por lote. Las DEVOLUCIONES de los
// pedidos del periodo se restan de las ventas (neto), no inflan el ingreso.
export function estadoResultados(orders: OrderWithItems[], gastos: Gasto[], movements: InventoryMovement[], lots: Lot[], refunds: RefundLine[] = []): EstadoResultados {
  const sales = orders.filter(isSale)
  const ventas = sales.reduce((s, o) => s + (o.total ?? 0), 0)
  const saleIds = new Set(sales.map((o) => o.id))
  const devoluciones = refunds.filter((r) => saleIds.has(r.order_id)).reduce((s, r) => s + (r.monto ?? 0), 0)
  const ventasNetas = ventas - devoluciones
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
  const mermas = movements.reduce((s, m) => (MERMA.has(m.reason ?? '') && m.change < 0 ? s + (-m.change) * lotCost(m.lot_id) : s), 0)
  const gastosTotal = gastos.reduce((s, g) => s + g.monto, 0)
  const utilidadBruta = ventasNetas - costoVentas
  const utilidadNeta = utilidadBruta - gastosTotal - mermas
  return {
    ventas,
    devoluciones,
    ventasNetas,
    costoVentas,
    utilidadBruta,
    gastos: gastosTotal,
    mermas,
    utilidadNeta,
    margenBruto: ventasNetas > 0 ? (utilidadBruta / ventasNetas) * 100 : 0,
    margenNeto: ventasNetas > 0 ? (utilidadNeta / ventasNetas) * 100 : 0,
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
// Esperado = ventas POS en EFECTIVO dentro del alcance (día u evento), MENOS las
// devoluciones en efectivo de esos pedidos (el dinero salió del cajón).
export function efectivoEsperado(orders: OrderWithItems[], opts: { day?: string; eventId?: string }, refunds: RefundLine[] = []): number {
  const inScope = orders
    .filter((o) => isPosOrder(o) && (o.payment_method === 'efectivo'))
    .filter((o) => {
      const meta = (o.shipping_meta ?? {}) as { event_id?: string | null }
      if (opts.eventId) return meta.event_id === opts.eventId
      if (opts.day) return o.created_at.slice(0, 10) === opts.day
      return true
    })
  const bruto = inScope.reduce((s, o) => s + (o.total ?? 0), 0)
  const ids = new Set(inScope.map((o) => o.id))
  const devueltoEfectivo = refunds
    .filter((r) => ids.has(r.order_id) && (r.metodo ?? 'efectivo') === 'efectivo')
    .reduce((s, r) => s + (r.monto ?? 0), 0)
  return bruto - devueltoEfectivo
}

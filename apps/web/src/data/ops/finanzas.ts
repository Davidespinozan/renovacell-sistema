// Lógica PURA de finanzas que NO es un KPI de cabecera: cuentas por pagar, desglose
// de gastos y la explicación del arqueo en la demo.
//
// Ventas, cobrado, por cobrar y utilidad ya NO se calculan aquí: su definición única
// vive en el servidor (`kpi_ventas`, `kpi_por_cobrar`, `kpi_resultado`) y su espejo en
// `data/kpis.ts`. Este módulo no debe volver a sumar dinero de pedidos.
import type { OrderWithItems } from '../hooks/useOrders'
import { isPosOrder } from '../metrics'
import { diaNegocio } from '../periodo'
import type { Gasto } from '../store/gastosStore'
import type { PurchaseOrder } from '../store/comprasStore'
import type { RefundLine } from '../kpis'

export type { RefundLine }

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
// W2 · El ESPERADO de un corte real lo calcula el SERVIDOR desde el libro
// (`efectivo_esperado`, ops/money.ts). La función pura de abajo queda para la demo
// sin backend y para explicar el número en pantalla; NUNCA se manda al comando.
// El "día" del arqueo es el DÍA DEL NEGOCIO (`diaNegocio`, America/Mazatlan): ni el día
// UTC —cuya frontera cae a las 17:00 locales y dejaba fuera las ventas de la tarde— ni
// el del dispositivo.
// Esperado = ventas POS en EFECTIVO dentro del alcance (día u evento), MENOS las
// devoluciones en efectivo de esos pedidos (el dinero salió del cajón).
export function efectivoEsperado(orders: OrderWithItems[], opts: { day?: string; eventId?: string; seller?: string; since?: string }, refunds: RefundLine[] = []): number {
  const sinceT = opts.since ? new Date(opts.since).getTime() : null
  const inScope = orders
    .filter((o) => isPosOrder(o) && (o.payment_method === 'efectivo'))
    .filter((o) => {
      const meta = (o.shipping_meta ?? {}) as { event_id?: string | null; seller?: string | null }
      // `since` (corte por turno): solo ventas POSTERIORES al último corte del mismo
      // alcance — así un segundo corte no vuelve a contar el efectivo ya retirado.
      if (sinceT !== null && new Date(o.created_at).getTime() <= sinceT) return false
      // `seller` es un filtro ADICIONAL (corte por cajero): combina con día/evento.
      if (opts.seller && meta.seller !== opts.seller) return false
      if (opts.eventId) return meta.event_id === opts.eventId
      if (opts.day) return diaNegocio(o.created_at) === opts.day
      return true
    })
  const bruto = inScope.reduce((s, o) => s + (o.total ?? 0), 0)
  const ids = new Set(inScope.map((o) => o.id))
  const devueltoEfectivo = refunds
    .filter((r) => ids.has(r.order_id) && (r.metodo ?? 'efectivo') === 'efectivo')
    .reduce((s, r) => s + (r.monto ?? 0), 0)
  return bruto - devueltoEfectivo
}

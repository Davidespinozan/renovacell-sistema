// POR CONFIRMAR (26 nov 2026, dueño: «que solo se pueda capturar la orden de venta como cotización y ya que pague, un
// botón de confirmar venta, y en ese momento pasa a almacén; que el sistema nos avise que hay pedidos por confirmar»).
// Un pedido SIN pagar y SIN crédito no se libera a Almacén (pedido_liberado_para_surtir). Confirmar = registrar el pago.
import type { OrderMoney } from './money'

interface PedidoMin { id: string; status?: string | null; payment_status?: string | null; total?: number | null }

const vivo = (o: PedidoMin) => o.status !== 'cancelled' && o.status !== 'draft' && o.payment_status !== 'paid' && o.payment_status !== 'refunded' && (o.total ?? 0) > 0

/** Pedidos que esperan el pago para pasar a Almacén (no liberados: sin pago completo ni crédito / paga al recibir). */
export function pedidosPorConfirmar<T extends PedidoMin>(orders: T[], byOrder: Record<string, OrderMoney | undefined>): T[] {
  return orders.filter((o) => vivo(o) && o.status !== 'delivered' && !(byOrder[o.id]?.liberado ?? false))
}

/** Ya salieron o ya están en Almacén pero falta el dinero (crédito, paga al recibir, mostrador «Paga más tarde»). */
export function pedidosPorCobrarSinConfirmar<T extends PedidoMin>(orders: T[], byOrder: Record<string, OrderMoney | undefined>): T[] {
  const pc = new Set(pedidosPorConfirmar(orders, byOrder).map((o) => o.id))
  return orders.filter((o) => vivo(o) && !pc.has(o.id))
}

// Reglas PURAS del webhook de Stripe (sin red/Deno) — compartidas por la función y sus tests.
// Deciden si un evento de Stripe debe marcar un pedido como pagado, validando estado e importe.

export interface SesionStripe {
  payment_status?: string | null   // 'paid' | 'unpaid' | 'no_payment_required'
  amount_total?: number | null     // en centavos
  metadata?: Record<string, string> | null
}
export interface PedidoMin { total?: number | null; payment_status?: string | null }

export function montoEsperadoCentavos(orderTotal: number | null | undefined): number {
  return Math.round(Number(orderTotal ?? 0) * 100)
}

// ¿Marcar el pedido como pagado? Solo si: Stripe confirma payment_status='paid', hay order_id,
// el pedido existe y el IMPORTE cobrado coincide con el total del pedido. Cualquier otra cosa NO
// marca pagado (devuelve el motivo para registrar/responder 200 sin reintento).
export function evaluarPago(
  session: SesionStripe,
  order: PedidoMin | null,
): { marcar: true; orderId: string } | { marcar: false; reason: string } {
  const orderId = session.metadata?.order_id
  if (session.payment_status !== 'paid') return { marcar: false, reason: 'not_paid' }
  if (!orderId) return { marcar: false, reason: 'no_order_id' }
  if (!order) return { marcar: false, reason: 'order_not_found' }
  if (session.amount_total != null && session.amount_total !== montoEsperadoCentavos(order.total)) {
    return { marcar: false, reason: 'amount_mismatch' }
  }
  return { marcar: true, orderId }
}

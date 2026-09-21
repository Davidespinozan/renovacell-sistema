// Resolución del NOMBRE DE CLIENTE de un pedido, coherente para pedidos legacy (doctor/profile) y
// customer-only. Prioridad, sin N+1: snapshot en shipping_meta.customer → doctor/profile legacy →
// "Cliente". El snapshot lo escribe crear_pedido/vender_pos al crear el pedido (historial estable).
export interface CustomerSnapshot { id: string | null; name: string; phone?: string | null }

export function customerSnapshot(shippingMeta: unknown): CustomerSnapshot | null {
  const c = (shippingMeta as { customer?: CustomerSnapshot } | null)?.customer
  return c && typeof c.name === 'string' && c.name.trim() ? c : null
}

// `doctorName` = resolutor del nombre legacy (por doctor_id), ya disponible en cada pantalla
// (mapa de doctores). Se llama solo si no hay snapshot de customer.
export function orderClientName(
  order: { doctor_id?: string | null; shipping_meta?: unknown },
  doctorName?: (doctorId: string) => string | null | undefined,
  fallback = 'Cliente',
): string {
  const snap = customerSnapshot(order.shipping_meta)
  if (snap) return snap.name
  if (order.doctor_id && doctorName) {
    const n = doctorName(order.doctor_id)
    if (n) return n
  }
  return fallback
}

// UN SOLO IDIOMA PARA EL PEDIDO (27 nov 2026, «sistema sencillo por rol»). Cuatro pasos que todos ven igual —vendedor,
// Almacén, Dirección y el doctor—: Por confirmar → En almacén → En camino (o Listo para recoger) → Entregado.
// El dinero se dice aparte (Pagado · Por cobrar · A crédito), porque un pedido puede pagarse antes o después de entregarse.
// Antes había cinco pasos ('Pedido','Pagado','Empacado','En camino','Entregado') y nueve etiquetas, entre ellas
// «Pendiente de pago», «Pagado», «En surtido» y «Empacado» para lo que aquí es una sola cosa.
import type { OrderStatus } from '../../data/types'

export const TRACK_STEPS = ['Pedido', 'En almacén', 'En camino', 'Entregado'] as const

export interface StatusView {
  label: string
  pill: 'p-ok' | 'p-warn' | 'p-blue' | 'p-neu' | 'p-dang'
  step: number
}

/** Pedidos que Almacén surte sin esperar el pago: a crédito o que se cobran al recibir. Misma regla que el seguimiento. */
export const seSurteSinPago = (o: { payment_method?: string | null }): boolean => ['contra_entrega', 'credito'].includes(o.payment_method ?? '')

// `recoge`: el pedido "enviado" de recoger en sucursal está LISTO PARA RECOGER, no en camino.
// `liberado`: un pedido sin pagar que ya se surte (crédito / paga al recibir) está EN ALMACÉN, no «por confirmar».
export function statusView(status: OrderStatus | null, opts: { recoge?: boolean; liberado?: boolean } = {}): StatusView {
  if (status === 'shipped' && opts.recoge) return { label: 'Listo para recoger', pill: 'p-warn', step: 2 }
  switch (status) {
    case 'draft': return { label: 'Borrador', pill: 'p-neu', step: 0 }
    case 'pending_payment': return opts.liberado ? { label: 'En almacén', pill: 'p-blue', step: 1 } : { label: 'Por confirmar', pill: 'p-warn', step: 0 }
    case 'paid':
    case 'picking':
    case 'packed': return { label: 'En almacén', pill: 'p-blue', step: 1 }
    case 'shipped': return { label: 'En camino', pill: 'p-blue', step: 2 }
    case 'delivered':
    case 'fulfilled': return { label: 'Entregado', pill: 'p-ok', step: 3 }
    case 'cancelled': return { label: 'Cancelado', pill: 'p-neu', step: 0 }
    default: return { label: '—', pill: 'p-neu', step: 0 }
  }
}

// Estatus que cuentan como "histórico" (pedidos pasados).
export const isPast = (status: OrderStatus | null): boolean =>
  status === 'delivered' || status === 'fulfilled' || status === 'cancelled'

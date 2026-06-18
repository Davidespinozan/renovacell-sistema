// Mapeo de estatus de pedido -> etiqueta, color de pill y paso del tracking.
// Pasos tomados del prototipo: ['Pedido','Pagado','Empacado','En camino','Entregado'].
import type { OrderStatus } from '../../data/types'

export const TRACK_STEPS = ['Pedido', 'Pagado', 'Empacado', 'En camino', 'Entregado'] as const

export interface StatusView {
  label: string
  pill: 'p-ok' | 'p-warn' | 'p-blue' | 'p-neu' | 'p-dang'
  step: number
}

export function statusView(status: OrderStatus | null): StatusView {
  switch (status) {
    case 'draft': return { label: 'Borrador', pill: 'p-neu', step: 0 }
    case 'pending_payment': return { label: 'Pendiente de pago', pill: 'p-warn', step: 0 }
    case 'paid': return { label: 'Pagado', pill: 'p-blue', step: 1 }
    case 'picking': return { label: 'En surtido', pill: 'p-blue', step: 1 }
    case 'packed': return { label: 'Empacado', pill: 'p-blue', step: 2 }
    case 'shipped': return { label: 'En camino', pill: 'p-blue', step: 3 }
    case 'delivered':
    case 'fulfilled': return { label: 'Entregado', pill: 'p-ok', step: 4 }
    case 'cancelled': return { label: 'Cancelado', pill: 'p-neu', step: 0 }
    default: return { label: '—', pill: 'p-neu', step: 0 }
  }
}

// Estatus que cuentan como "histórico" (pedidos pasados).
export const isPast = (status: OrderStatus | null): boolean =>
  status === 'delivered' || status === 'fulfilled' || status === 'cancelled'

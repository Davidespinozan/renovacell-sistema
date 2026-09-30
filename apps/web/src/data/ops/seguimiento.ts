// Diagnóstico de envíos/pedidos COMPARTIDO. Única fuente de verdad para
// "atorado" y "pendiente de surtir": lo usan Seguimiento, Almacén y el Tablero.
import type { Shipment } from '../types'
import type { OrderWithItems } from '../store/ordersStore'

export interface Diagnosis {
  stuck: boolean
  reason: string
  statusLabel: string
  statusPill: string
}

// Un pedido está pendiente de surtir si está LIBERADO y aún no se empacó/envió/entregó/
// canceló. W2 · liberado = cobro suficiente O crédito autorizado vigente — exactamente la
// misma condición que aplica el servidor en `surtir_pedido`
// (`pedido_liberado_para_surtir`), para que la pantalla no ofrezca lo que el comando va a
// rechazar ni esconda lo que sí se puede surtir. Un crédito NO vuelve "pagado" el pedido:
// solo lo libera. Sin libro de dinero (demo) se cae a lo único observable: payment_status.
export const isSurtible = (o: OrderWithItems, dinero?: { liberado: boolean } | null): boolean =>
  (dinero ? dinero.liberado : o.payment_status === 'paid') &&
  !['packed', 'shipped', 'delivered', 'fulfilled', 'cancelled'].includes(o.status ?? '')

// Diagnóstico de un envío en curso: detecta atorados (vencido o surtido sin salir).
export function diagnoseShipment(order: OrderWithItems, shipment: Shipment | undefined): Diagnosis {
  let stuck = false
  let reason = ''
  let statusLabel = 'En proceso'
  let statusPill = 'p-neu'

  if (order.status === 'delivered') {
    statusLabel = 'Entregado'; statusPill = 'p-ok'
  } else if (!shipment) {
    // Empacado pero sin envío asignado = surtido sin salir.
    statusLabel = 'Empacado · sin asignar'; statusPill = 'p-warn'
    stuck = true
    const days = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 86_400_000)
    reason = `Surtido sin salir${days > 0 ? ` · ${days} días detenido` : ''}`
  } else {
    const overdue =
      shipment.status !== 'delivered' &&
      shipment.estimated_delivery_at != null &&
      new Date(shipment.estimated_delivery_at).getTime() < Date.now()
    switch (shipment.status) {
      case 'assigned': statusLabel = 'Asignado a chofer'; statusPill = 'p-warn'; break
      case 'por_despachar': statusLabel = 'Por despachar'; statusPill = 'p-warn'; break
      case 'despachado': statusLabel = 'Despachado'; statusPill = 'p-blue'; break
      case 'out_for_delivery': statusLabel = 'En reparto'; statusPill = 'p-blue'; break
      case 'in_transit': statusLabel = 'En camino'; statusPill = 'p-blue'; break
      case 'delivered': statusLabel = 'Entregado'; statusPill = 'p-ok'; break
      default: statusLabel = shipment.status ?? '—'
    }
    if (overdue) {
      stuck = true
      reason = 'Entrega vencida · pasó su fecha estimada sin avanzar'
      statusPill = 'p-dang'
    }
  }
  return { stuck, reason, statusLabel, statusPill }
}

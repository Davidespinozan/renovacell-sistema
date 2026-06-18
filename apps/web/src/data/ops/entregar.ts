// Entrega: cierra el ciclo (En camino -> Entregado). Marca el envío como
// entregado (con foto de prueba) y el pedido como Entregado. Conecta ambos stores.
import { markDelivered as markShipmentDelivered } from '../store/shipmentsStore'
import { markDelivered as markOrderDelivered } from '../store/ordersStore'

export function entregar(shipmentId: string, orderId: string, proofUrl: string | null) {
  markShipmentDelivered(shipmentId, proofUrl)
  markOrderDelivered(orderId)
}

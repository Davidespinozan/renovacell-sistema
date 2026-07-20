// Entrega: cierra el ciclo (En camino -> Entregado). Marca el envío como
// entregado (con foto de prueba) y el pedido como Entregado.
//
// Las dos escrituras van juntas en el RPC `confirmar_entrega`: el chofer no
// tiene permiso para escribir en `orders` desde el cliente, así que al hacerlo
// por separado el envío quedaba entregado y el pedido "enviado" para siempre.
// La UI se actualiza al momento (optimista) y el RPC es la fuente de verdad.
import { hasSupabase, supabase } from '../../lib/supabase'
import { markDelivered as markShipmentDelivered } from '../store/shipmentsStore'
import { markDelivered as markOrderDelivered } from '../store/ordersStore'

const isUuid = (s: string | null | undefined): boolean => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

export function entregar(shipmentId: string, orderId: string, proofUrl: string | null, receivedBy: string | null = null) {
  if (hasSupabase && isUuid(shipmentId)) {
    // Pinta la entrega de inmediato (el chofer suele estar en la calle) y deja
    // que el RPC confirme. Si falla, la siguiente recarga devuelve la verdad.
    markShipmentDelivered(shipmentId, proofUrl, receivedBy, { remote: false })
    markOrderDelivered(orderId, { remote: false })
    supabase
      .rpc('confirmar_entrega', {
        p_shipment_id: shipmentId,
        p_proof_path: proofUrl ?? undefined,
        p_received_by: receivedBy ?? undefined,
      })
      .then(({ error }) => { if (error) console.warn('[entrega] confirmar_entrega', error.message) })
    return
  }
  markShipmentDelivered(shipmentId, proofUrl, receivedBy)
  markOrderDelivered(orderId)
}
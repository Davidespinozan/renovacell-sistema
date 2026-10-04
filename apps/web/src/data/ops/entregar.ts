// Entrega: cierra el ciclo (En camino -> Entregado). Marca el envío como
// entregado (con foto de prueba) y el pedido como Entregado.
//
// Las dos escrituras van juntas en el RPC `confirmar_entrega`: el chofer no
// tiene permiso para escribir en `orders` desde el cliente, así que al hacerlo
// por separado el envío quedaba entregado y el pedido "enviado" para siempre.
//
// W4: la pantalla ya NO se adelanta al servidor. Antes pintaba "entregado" de
// inmediato y, si el RPC fallaba —lo normal con mala señal, que es justo donde
// trabaja un chofer—, el rechazo quedaba en la consola: el chofer se iba con una
// entrega que el sistema nunca registró.
import { hasSupabase, supabase } from '../../lib/supabase'
import { markDelivered as markShipmentDelivered } from '../store/shipmentsStore'
import { markDelivered as markOrderDelivered } from '../store/ordersStore'
import { confirmar, type Escritura } from '../store/escritura'

const isUuid = (s: string | null | undefined): boolean => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

export async function entregar(shipmentId: string, orderId: string, proofUrl: string | null, receivedBy: string | null = null): Promise<Escritura> {
  if (hasSupabase && isUuid(shipmentId)) {
    // `confirmar_entrega` es idempotente (si ya está entregado, no hace nada), así
    // que ante un resultado desconocido reintentar es seguro y se le dice al chofer.
    const r = await confirmar('confirmar la entrega',
      supabase.rpc('confirmar_entrega', {
        p_shipment_id: shipmentId,
        p_proof_path: proofUrl ?? undefined,
        p_received_by: receivedBy ?? undefined,
      }),
      { origen: 'comando', reintentoSeguro: true })
    if (!r.ok) return r
    // El servidor ya escribió ambas cosas: solo se refleja en pantalla.
    await markShipmentDelivered(shipmentId, proofUrl, receivedBy, { remote: false })
    await markOrderDelivered(orderId, { remote: false })
    return { ok: true }
  }
  const a = await markShipmentDelivered(shipmentId, proofUrl, receivedBy)
  if (!a.ok) return a
  return markOrderDelivered(orderId)
}

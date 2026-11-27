// PESTAÑAS CON SU NÚMERO (27 nov 2026, «sistema sencillo por rol»): las 8 pestañas de «Pedidos» no decían cuántos había
// en cada una y el grupo abría en la última usada aunque estuviera vacía. Aquí se cuenta el trabajo de cada pestaña con
// las MISMAS reglas que usa su pantalla, y se decide con cuál conviene abrir. El registro de pantallas no cambia.
import { useMemo } from 'react'
import { useAllOrders, type OrderWithItems } from '../data/hooks/useOrders'
import { useOrderMoney } from '../data/hooks/useMoney'
import { useShipments } from '../data/hooks/useShipments'
import { envioVigente, isSurtible } from '../data/ops/seguimiento'
import { paraRecoger } from '../screens/logistics/ParaRecoger'
import type { Shipment } from '../data/types'

export type Conteos = Record<string, number>

/** Trabajo pendiente por pestaña de «Pedidos» (Almacén y auxiliar). */
export function contarPedidos(orders: OrderWithItems[], liberado: (o: OrderWithItems) => boolean, shipments: Shipment[]): Conteos {
  return {
    surtido: orders.filter((o) => isSurtible(o, { liberado: liberado(o) })).length,
    cola: orders.filter((o) => o.status === 'packed').length,
    despacho: shipments.filter((s) => s.status === 'por_despachar').length,
    para_recoger: paraRecoger(orders, (id) => !!envioVigente(shipments, id)).length,
    seguimiento: shipments.filter((s) => s.incident && !s.incident.resolved && s.status !== 'delivered' && s.status !== 'cancelado').length,
  }
}

export function useConteosPedidos(): Conteos {
  const { data: orders } = useAllOrders()
  const { byOrder } = useOrderMoney()
  const { data: shipments } = useShipments()
  return useMemo(() => contarPedidos(orders, (o) => byOrder[o.id]?.liberado ?? o.payment_status === 'paid', shipments), [orders, byOrder, shipments])
}

/** Grupos cuyas pestañas llevan número. */
export const CONTEOS_POR_GRUPO: Record<string, () => Conteos> = { g_pedidos: useConteosPedidos, g_pedidos_aux: useConteosPedidos }

/** Con cuál pestaña abrir. Se respeta la última usada salvo que sea una pestaña DE TRABAJO que quedó vacía habiendo
 *  trabajo en otra; una pestaña de consulta (Guías, Horarios…) nunca se cambia. Sin nada que decidir devuelve null. */
export function pestanaConTrabajo(claves: string[], recordada: string | null, conteos: Conteos): string | null {
  const conTrabajo = claves.find((k) => (conteos[k] ?? 0) > 0) ?? null
  if (!recordada) return conTrabajo
  if (!(recordada in conteos) || conteos[recordada] > 0) return recordada
  return conTrabajo ?? recordada
}

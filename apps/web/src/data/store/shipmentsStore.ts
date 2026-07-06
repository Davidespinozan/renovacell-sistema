// Store compartido de envíos (mock). Alimenta Empaque (Guías/Recibo) y, después,
// Seguimiento (el chofer/paquetería actualizan estatus). Al migrar a Supabase:
// insert/select sobre shipments; el hook useShipments no cambia.
import type { Shipment } from '../types'
import { MOCK_SHIPMENTS } from '../mock/shipments'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { hasSupabase } from '../../lib/supabase'

// Con backend arranca vacío (los envíos reales nacen del uso).
let shipments: Shipment[] = hasSupabase ? [] : [...MOCK_SHIPMENTS]
let seq = 5000

const listeners = new Set<() => void>()
let snapshot: Shipment[] = sortDesc(shipments)

function sortDesc(s: Shipment[]): Shipment[] {
  return [...s].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}
function emit() {
  snapshot = sortDesc(shipments)
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): Shipment[] => snapshot

export interface ShipmentInput {
  order_id: string
  carrier: string | null
  tracking_number: string | null
  label_url?: string | null
  driver_id: string | null
  estimated_delivery_at: string | null
  status: string // 'in_transit' (paquetería) | 'assigned' (chofer)
}

export function createShipment(input: ShipmentInput): Shipment {
  seq += 1
  const sh: Shipment = {
    id: `sh-${seq}`,
    order_id: input.order_id,
    carrier: input.carrier,
    tracking_number: input.tracking_number,
    label_url: input.label_url ?? null,
    driver_id: input.driver_id,
    status: input.status,
    estimated_delivery_at: input.estimated_delivery_at,
    delivered_at: null,
    proof_image_url: null,
    received_by: null,
    incident: null,
    created_at: new Date().toISOString(),
  }
  shipments = [sh, ...shipments]
  emit()
  if (input.driver_id) notify({ text: 'Carga por despachar para tu ruta', roles: ['driver'], screen: 'driver_home' })
  return sh
}

// Despacho (Empaque o Administración): autoriza y registra la entrega de la carga
// al chofer (quién y cuándo). El chofer aún debe confirmar que la recibió.
export function dispatchShipment(id: string, by: string, folio: string) {
  const now = new Date().toISOString()
  shipments = shipments.map((s) => (s.id === id ? { ...s, status: 'despachado', dispatched_by: by, dispatched_at: now } : s))
  emit()
  notify({ text: `Carga despachada · confirma recepción (${folio})`, roles: ['driver'], screen: 'driver_home' })
  logAudit({ actor: by, action: 'Carga despachada al chofer', resource: folio })
}

// El chofer confirma que recibió sus paquetes → entra a reparto.
export function confirmLoad(id: string, who: string, folio: string) {
  const now = new Date().toISOString()
  shipments = shipments.map((s) => (s.id === id ? { ...s, status: 'out_for_delivery', load_confirmed_at: now } : s))
  emit()
  logAudit({ actor: who, action: 'Carga recibida (chofer)', resource: folio })
}

// Incidencia en entrega (chofer): registra el problema y avisa a logística/admin.
export function reportIncident(shipmentId: string, type: string, note: string | null, folio: string) {
  const now = new Date().toISOString()
  shipments = shipments.map((s) =>
    s.id === shipmentId ? { ...s, status: 'incident', incident: { type, note, at: now, resolved: false } } : s,
  )
  emit()
  notify({ text: `Incidencia en ${folio}: ${type}`, roles: ['admin'], screen: 'seguimiento' })
  logAudit({ actor: 'Chofer', action: 'Incidencia reportada', resource: folio, detail: type })
}

// Resolver incidencia (logística/admin): reintentar entrega (vuelve a reparto).
export function resolveIncident(shipmentId: string, folio: string) {
  shipments = shipments.map((s) =>
    s.id === shipmentId && s.incident
      ? { ...s, status: 'out_for_delivery', incident: { ...s.incident, resolved: true } }
      : s,
  )
  emit()
  notify({ text: `Incidencia de ${folio} resuelta · reintento de entrega`, roles: ['driver'], screen: 'driver_home' })
  logAudit({ actor: 'Administración', action: 'Incidencia resuelta', resource: folio })
}

// Entrega confirmada por el chofer: estatus Entregado + foto de prueba + quién recibió.
export function markDelivered(shipmentId: string, proofUrl: string | null, receivedBy: string | null = null) {
  const now = new Date().toISOString()
  shipments = shipments.map((s) =>
    s.id === shipmentId ? { ...s, status: 'delivered', delivered_at: now, proof_image_url: proofUrl, received_by: receivedBy } : s,
  )
  emit()
}

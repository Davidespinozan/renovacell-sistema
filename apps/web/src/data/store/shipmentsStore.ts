// Store de envíos. Con backend hidrata de `shipments` (RLS: staff/admin todos;
// chofer los suyos por driver_id=auth.uid(); doctor los de sus pedidos) y las
// mutaciones escriben write-through. El guard limita al chofer a estado/entrega.
// Sin backend, opera sobre el mock. driver_id = uuid del perfil del chofer.
import type { Shipment } from '../types'
import { MOCK_SHIPMENTS, loadDrivers } from '../mock/shipments'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'
import type { Json } from '../database.types'

const isUuid = (s: string | null | undefined): boolean => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)
const uuid = (): string => (globalThis.crypto?.randomUUID?.() ?? `sh-${Math.random().toString(16).slice(2)}`)

const live = makeLive<Shipment>(async () => {
  // Espera a que carguen los choferes ANTES de emitir: así driverName()/driverIdByEmail()
  // ya resuelven cuando la pantalla (que se suscribe a envíos) re-renderiza.
  await loadDrivers()
  const { data, error } = await supabase.from('shipments')
    .select('id, order_id, carrier, tracking_number, label_url, driver_id, status, estimated_delivery_at, delivered_at, proof_image_url, received_by, incident, dispatched_by, dispatched_at, load_confirmed_at, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Shipment[]
}, MOCK_SHIPMENTS)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

export interface ShipmentInput {
  order_id: string
  carrier: string | null
  tracking_number: string | null
  label_url?: string | null
  driver_id: string | null
  estimated_delivery_at: string | null
  status: string
}

export function createShipment(input: ShipmentInput): Shipment {
  const id = hasSupabase ? uuid() : `sh-${Math.floor(Math.random() * 1e6)}`
  const sh: Shipment = {
    id, order_id: input.order_id, carrier: input.carrier, tracking_number: input.tracking_number,
    label_url: input.label_url ?? null, driver_id: input.driver_id, status: input.status,
    estimated_delivery_at: input.estimated_delivery_at, delivered_at: null, proof_image_url: null,
    received_by: null, incident: null, created_at: new Date().toISOString(),
  }
  live.setLocal([sh, ...live.current()])
  if (input.driver_id) notify({ text: 'Carga por despachar para tu ruta', roles: ['driver'], screen: 'driver_home' })
  if (hasSupabase && isUuid(input.order_id)) {
    supabase.from('shipments').insert({
      id, order_id: input.order_id, carrier: input.carrier, tracking_number: input.tracking_number,
      label_url: input.label_url ?? null, driver_id: isUuid(input.driver_id) ? input.driver_id : null,
      status: input.status, estimated_delivery_at: input.estimated_delivery_at,
    }).then(({ error }) => { if (error) console.warn('[shipments] insert', error.message); live.reload() })
  }
  return sh
}

// `remote: false` actualiza solo la pantalla: se usa cuando quien escribe en la
// base es un RPC (ver ops/entregar), para no mandar dos veces lo mismo.
function patch(id: string, fields: Partial<Shipment>, opts: { remote?: boolean } = {}) {
  live.setLocal(live.current().map((s) => (s.id === id ? { ...s, ...fields } : s)))
  if (opts.remote !== false && hasSupabase && isUuid(id)) {
    supabase.from('shipments').update(fields as unknown as never).eq('id', id).then(({ error }) => { if (error) console.warn('[shipments] update', error.message); live.reload() })
  }
}

export function dispatchShipment(id: string, by: string, folio: string) {
  patch(id, { status: 'despachado', dispatched_by: by, dispatched_at: new Date().toISOString() })
  notify({ text: `Carga despachada · confirma recepción (${folio})`, roles: ['driver'], screen: 'driver_home' })
  logAudit({ actor: by, action: 'Carga despachada al chofer', resource: folio })
}

export function confirmLoad(id: string, who: string, folio: string) {
  patch(id, { status: 'out_for_delivery', load_confirmed_at: new Date().toISOString() })
  logAudit({ actor: who, action: 'Carga recibida (chofer)', resource: folio })
}

export function reportIncident(shipmentId: string, type: string, note: string | null, folio: string) {
  const incident = { type, note, at: new Date().toISOString(), resolved: false } as Shipment['incident']
  live.setLocal(live.current().map((s) => (s.id === shipmentId ? { ...s, status: 'incident', incident } : s)))
  if (hasSupabase && isUuid(shipmentId)) supabase.from('shipments').update({ status: 'incident', incident: incident as unknown as Json }).eq('id', shipmentId).then(({ error }) => { if (error) console.warn('[shipments] incident', error.message); live.reload() })
  notify({ text: `Incidencia en ${folio}: ${type}`, roles: ['admin'], screen: 'seguimiento' })
  logAudit({ actor: 'Chofer', action: 'Incidencia reportada', resource: folio, detail: type })
}

export function resolveIncident(shipmentId: string, folio: string) {
  const cur = live.current().find((s) => s.id === shipmentId)
  if (!cur?.incident) return
  const incident = { ...(cur.incident as unknown as Record<string, unknown>), resolved: true } as Shipment['incident']
  live.setLocal(live.current().map((s) => (s.id === shipmentId ? { ...s, status: 'out_for_delivery', incident } : s)))
  if (hasSupabase && isUuid(shipmentId)) supabase.from('shipments').update({ status: 'out_for_delivery', incident: incident as unknown as Json }).eq('id', shipmentId).then(() => live.reload())
  notify({ text: `Incidencia de ${folio} resuelta · reintento de entrega`, roles: ['driver'], screen: 'driver_home' })
  logAudit({ actor: 'Administración', action: 'Incidencia resuelta', resource: folio })
}

export function markDelivered(shipmentId: string, proofUrl: string | null, receivedBy: string | null = null, opts: { remote?: boolean } = {}) {
  patch(shipmentId, { status: 'delivered', delivered_at: new Date().toISOString(), proof_image_url: proofUrl, received_by: receivedBy }, opts)
}

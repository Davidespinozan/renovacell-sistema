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
import { confirmar, type Escritura } from './escritura'

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

// Un envío solo "se registró" cuando el servidor lo confirmó.
export type EnvioCreado = { ok: true; shipment: Shipment } | { ok: false; error: string; ambiguous: boolean }

export async function createShipment(input: ShipmentInput): Promise<EnvioCreado> {
  const id = hasSupabase ? uuid() : `sh-${Math.floor(Math.random() * 1e6)}`
  const sh: Shipment = {
    id, order_id: input.order_id, carrier: input.carrier, tracking_number: input.tracking_number,
    label_url: input.label_url ?? null, driver_id: input.driver_id, status: input.status,
    estimated_delivery_at: input.estimated_delivery_at, delivered_at: null, proof_image_url: null,
    received_by: null, incident: null, created_at: new Date().toISOString(),
  }
  if (hasSupabase && isUuid(input.order_id)) {
    const r = await confirmar('registrar el envío', supabase.from('shipments').insert({
      id, order_id: input.order_id, carrier: input.carrier, tracking_number: input.tracking_number,
      label_url: input.label_url ?? null, driver_id: isUuid(input.driver_id) ? input.driver_id : null,
      status: input.status, estimated_delivery_at: input.estimated_delivery_at,
    }))
    if (!r.ok) return r
  }
  // Con el envío ya registrado: pantalla y aviso al chofer. Antes el chofer recibía
  // "carga por despachar" de un envío que el servidor podía haber rechazado.
  live.setLocal([sh, ...live.current()])
  if (input.driver_id) notify({ text: 'Carga por despachar para tu ruta', roles: ['driver'], screen: 'driver_home' })
  if (hasSupabase && isUuid(input.order_id)) void live.reload()
  return { ok: true, shipment: sh }
}

// `remote: false` actualiza solo la pantalla: se usa cuando quien escribe en la
// base es un RPC (ver ops/entregar), para no mandar dos veces lo mismo.
// Confirma PRIMERO y pinta DESPUÉS: la pantalla nunca va por delante del servidor.
async function patch(que: string, id: string, fields: Partial<Shipment>, opts: { remote?: boolean } = {}): Promise<Escritura> {
  if (opts.remote !== false && hasSupabase && isUuid(id)) {
    const r = await confirmar(que, supabase.from('shipments').update(fields as unknown as never).eq('id', id))
    if (!r.ok) { void live.reload(); return r }
  }
  live.setLocal(live.current().map((s) => (s.id === id ? { ...s, ...fields } : s)))
  return { ok: true }
}

export async function dispatchShipment(id: string, by: string, folio: string): Promise<Escritura> {
  const r = await patch(`despachar ${folio} al chofer`, id, { status: 'despachado', dispatched_by: by, dispatched_at: new Date().toISOString() })
  if (!r.ok) return r
  notify({ text: `Carga despachada · confirma recepción (${folio})`, roles: ['driver'], screen: 'driver_home' })
  logAudit({ actor: by, action: 'Carga despachada al chofer', resource: folio })
  return r
}

export async function confirmLoad(id: string, who: string, folio: string): Promise<Escritura> {
  const r = await patch(`confirmar la carga de ${folio}`, id, { status: 'out_for_delivery', load_confirmed_at: new Date().toISOString() })
  if (!r.ok) return r
  logAudit({ actor: who, action: 'Carga recibida (chofer)', resource: folio })
  return r
}

export async function reportIncident(shipmentId: string, type: string, note: string | null, folio: string, opts: { toWarehouse?: boolean } = {}): Promise<Escritura> {
  const incident = { type, note, at: new Date().toISOString(), resolved: false } as Shipment['incident']
  const r = await patch(`reportar la incidencia de ${folio}`, shipmentId, { status: 'incident', incident })
  // Una incidencia que no se guardó NO se avisa: Dirección quedaría buscando un
  // problema que el sistema no tiene registrado.
  if (!r.ok) return r
  notify({ text: `Incidencia en ${folio}: ${type}`, roles: ['admin'], screen: 'seguimiento' })
  // Problema con la CARGA (antes de salir): Almacén debe corregir/re-surtir antes del reparto.
  if (opts.toWarehouse) notify({ text: `Problema con la carga de ${folio}: ${type} · revisar antes de que salga`, roles: ['warehouse'], screen: 'despacho' })
  logAudit({ actor: 'Chofer', action: 'Incidencia reportada', resource: folio, detail: type })
  return r
}

export async function resolveIncident(shipmentId: string, folio: string): Promise<Escritura> {
  const cur = live.current().find((s) => s.id === shipmentId)
  if (!cur?.incident) return { ok: false, error: 'Este envío ya no tiene una incidencia abierta: recarga para ver su estado.', ambiguous: false }
  const incident = { ...(cur.incident as unknown as Record<string, unknown>), resolved: true } as Shipment['incident']
  const r = await patch(`resolver la incidencia de ${folio}`, shipmentId, { status: 'out_for_delivery', incident })
  if (!r.ok) return r
  notify({ text: `Incidencia de ${folio} resuelta · reintento de entrega`, roles: ['driver'], screen: 'driver_home' })
  logAudit({ actor: 'Administración', action: 'Incidencia resuelta', resource: folio })
  return r
}

export async function markDelivered(shipmentId: string, proofUrl: string | null, receivedBy: string | null = null, opts: { remote?: boolean } = {}): Promise<Escritura> {
  // R-63: si el envío traía una incidencia sin resolver, ciérrala al entregar (antes quedaba
  // como incident.resolved=false para siempre, invisible: "una incidencia que nunca se resuelve").
  const cur = live.current().find((s) => s.id === shipmentId)
  const inc = cur?.incident as unknown as Record<string, unknown> | null
  const extra = inc && inc.resolved !== true
    ? { incident: { ...inc, resolved: true, resolved_at: new Date().toISOString(), resolved_on_delivery: true } as unknown as Shipment['incident'] }
    : {}
  return patch('marcar el envío como entregado', shipmentId, { status: 'delivered', delivered_at: new Date().toISOString(), proof_image_url: proofUrl, received_by: receivedBy, ...extra }, opts)
}

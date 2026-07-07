// SOLICITUDES DE RECURSO (Vista Común / Diseño). El equipo pide artes/recursos
// desde la Vista Común; quien tenga la capability "Diseño" las atiende (en proceso
// → entregado, y sube el resultado a la biblioteca). Con backend (hasSupabase)
// hidrata de `resource_requests` (RLS: staff lee/crea; solo admin o cap 'diseno'
// avanza el estatus) y las mutaciones escriben write-through. Sin backend, mock.
import { notify } from './notificationsStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'

export type ResourceStatus = 'solicitado' | 'en_proceso' | 'entregado'
// origin: 'equipo' = lo pidió alguien del equipo; 'propio' = lo planeó Diseño por
// iniciativa propia (un pendiente que nadie solicitó).
export type ResourceOrigin = 'equipo' | 'propio'
export interface ResourceRequest {
  id: string
  title: string
  description: string
  requestedBy: string
  origin: ResourceOrigin
  status: ResourceStatus
  at: string
  assetUrl?: string
}

const isUuid = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)
const uuid = (): string => (globalThis.crypto?.randomUUID?.() ?? `rr-${Math.random().toString(16).slice(2)}`)

const SEED: ResourceRequest[] = [
  { id: 'rr-sample-1', title: 'Banner para congreso CDMX', description: 'Arte para el stand, línea Home Care.', requestedBy: 'Lucía · Ventas', origin: 'equipo', status: 'solicitado', at: '2026-06-18T16:00:00.000Z' },
  { id: 'rr-sample-2', title: 'Ficha visual Golden Serum', description: 'Una lámina para mostrar a doctores.', requestedBy: 'Dirección', origin: 'equipo', status: 'en_proceso', at: '2026-06-16T12:00:00.000Z' },
  { id: 'rr-sample-3', title: 'Plantillas para redes — julio', description: 'Set de posts mensual (idea propia, sin solicitud).', requestedBy: 'Diseño', origin: 'propio', status: 'solicitado', at: '2026-06-22T09:00:00.000Z' },
]

const live = makeLive<ResourceRequest>(async () => {
  const { data, error } = await supabase.from('resource_requests')
    .select('id, title, description, requested_by, origin, status, asset_url, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id, title: r.title, description: r.description ?? '', requestedBy: r.requested_by ?? '',
    origin: (r.origin as ResourceOrigin) ?? 'equipo', status: (r.status as ResourceStatus) ?? 'solicitado',
    at: r.created_at ?? '', assetUrl: r.asset_url ?? undefined,
  }))
}, SEED)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

export function addRequest(input: { title: string; description: string; requestedBy: string; origin?: ResourceOrigin; status?: ResourceStatus }): ResourceRequest {
  const origin = input.origin ?? 'equipo'
  const r: ResourceRequest = {
    id: hasSupabase ? uuid() : `rr-${Date.now()}`, title: input.title, description: input.description,
    requestedBy: input.requestedBy, origin, status: input.status ?? 'solicitado', at: new Date().toISOString(),
  }
  live.setLocal([r, ...live.current()])
  // Solo avisamos cuando es una solicitud del equipo; un pendiente propio de
  // Diseño no necesita notificar a nadie más.
  if (origin === 'equipo') notify({ text: `Nueva solicitud de recurso: ${input.title}`, screen: 'dis_solicitudes' })
  if (hasSupabase) {
    supabase.from('resource_requests').insert({
      id: r.id, title: r.title, description: r.description, requested_by: r.requestedBy,
      origin: r.origin, status: r.status,
    }).then(({ error }) => { if (error) console.warn('[resources] insert', error.message); live.reload() })
  }
  return r
}

export function setStatus(id: string, status: ResourceStatus) {
  live.setLocal(live.current().map((r) => (r.id === id ? { ...r, status } : r)))
  if (hasSupabase && isUuid(id)) supabase.from('resource_requests').update({ status }).eq('id', id).then(({ error }) => { if (error) console.warn('[resources] status', error.message); live.reload() })
}

// Entregar el recurso: adjunta el archivo subido y marca entregado.
export function deliver(id: string, assetUrl: string) {
  live.setLocal(live.current().map((r) => (r.id === id ? { ...r, status: 'entregado', assetUrl } : r)))
  if (hasSupabase && isUuid(id)) supabase.from('resource_requests').update({ status: 'entregado', asset_url: assetUrl }).eq('id', id).then(({ error }) => { if (error) console.warn('[resources] deliver', error.message); live.reload() })
}

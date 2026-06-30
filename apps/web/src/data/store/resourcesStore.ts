// SOLICITUDES DE RECURSO (Vista Común / Diseño). El equipo pide artes/recursos
// desde la Vista Común; quien tenga la capability "Diseño" las atiende (en proceso
// → entregado, y sube el resultado a la biblioteca). Mock; con Supabase = tabla.
import { notify } from './notificationsStore'

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

let items: ResourceRequest[] = [
  { id: 'rr-sample-1', title: 'Banner para congreso CDMX', description: 'Arte para el stand, línea Home Care.', requestedBy: 'Lucía · Ventas', origin: 'equipo', status: 'solicitado', at: '2026-06-18T16:00:00.000Z' },
  { id: 'rr-sample-2', title: 'Ficha visual Golden Serum', description: 'Una lámina para mostrar a doctores.', requestedBy: 'Dirección', origin: 'equipo', status: 'en_proceso', at: '2026-06-16T12:00:00.000Z' },
  { id: 'rr-sample-3', title: 'Plantillas para redes — julio', description: 'Set de posts mensual (idea propia, sin solicitud).', requestedBy: 'Diseño', origin: 'propio', status: 'solicitado', at: '2026-06-22T09:00:00.000Z' },
]
let seq = 0
const listeners = new Set<() => void>()
let snapshot: ResourceRequest[] = [...items]

function emit() { snapshot = [...items]; listeners.forEach((l) => l()) }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }
export const getSnapshot = (): ResourceRequest[] => snapshot

export function addRequest(input: { title: string; description: string; requestedBy: string; origin?: ResourceOrigin; status?: ResourceStatus }): ResourceRequest {
  seq += 1
  const origin = input.origin ?? 'equipo'
  const r: ResourceRequest = { id: `rr-${seq}`, title: input.title, description: input.description, requestedBy: input.requestedBy, origin, status: input.status ?? 'solicitado', at: new Date().toISOString() }
  items = [r, ...items]
  emit()
  // Solo avisamos cuando es una solicitud del equipo; un pendiente propio de
  // Diseño no necesita notificar a nadie más.
  if (origin === 'equipo') notify({ text: `Nueva solicitud de recurso: ${input.title}`, screen: 'dis_solicitudes' })
  return r
}

export function setStatus(id: string, status: ResourceStatus) {
  items = items.map((r) => (r.id === id ? { ...r, status } : r))
  emit()
}

// Entregar el recurso: adjunta el archivo subido y marca entregado.
export function deliver(id: string, assetUrl: string) {
  items = items.map((r) => (r.id === id ? { ...r, status: 'entregado', assetUrl } : r))
  emit()
}

// SOLICITUDES DE RECURSO (Vista Común / Diseño). El equipo pide artes/recursos
// desde la Vista Común; quien tenga la capability "Diseño" las atiende (en proceso
// → entregado, y sube el resultado a la biblioteca). Mock; con Supabase = tabla.
import { notify } from './notificationsStore'

export type ResourceStatus = 'solicitado' | 'en_proceso' | 'entregado'
export interface ResourceRequest {
  id: string
  title: string
  description: string
  requestedBy: string
  status: ResourceStatus
  at: string
  assetUrl?: string
}

let items: ResourceRequest[] = [
  { id: 'rr-sample-1', title: 'Banner para congreso CDMX', description: 'Arte para el stand, línea Home Care.', requestedBy: 'Lucía · Ventas', status: 'solicitado', at: '2026-06-18T16:00:00.000Z' },
  { id: 'rr-sample-2', title: 'Ficha visual Golden Serum', description: 'Una lámina para mostrar a doctores.', requestedBy: 'Dirección', status: 'en_proceso', at: '2026-06-16T12:00:00.000Z' },
]
let seq = 0
const listeners = new Set<() => void>()
let snapshot: ResourceRequest[] = [...items]

function emit() { snapshot = [...items]; listeners.forEach((l) => l()) }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }
export const getSnapshot = (): ResourceRequest[] => snapshot

export function addRequest(input: { title: string; description: string; requestedBy: string }): ResourceRequest {
  seq += 1
  const r: ResourceRequest = { id: `rr-${seq}`, title: input.title, description: input.description, requestedBy: input.requestedBy, status: 'solicitado', at: new Date().toISOString() }
  items = [r, ...items]
  emit()
  notify({ text: `Nueva solicitud de recurso: ${input.title}`, screen: 'dis_solicitudes' })
  return r
}

export function setStatus(id: string, status: ResourceStatus) {
  items = items.map((r) => (r.id === id ? { ...r, status } : r))
  emit()
}

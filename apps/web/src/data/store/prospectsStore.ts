// Store compartido de PROSPECTOS (leads). Forma de la tabla `prospects` (PII,
// staff-only). Hoy mock; mañana Supabase: select/insert/update con RLS staff.
// La captura AUTOMÁTICA desde la landing (agente IA / formulario) se conecta en
// la fase de Supabase (un insert a prospects desde el front público / función);
// hoy el equipo da de alta manual los que llegan por WhatsApp/llamada.
import type { Prospect } from '../types'
import { notify } from './notificationsStore'

export type ProspectStatus = 'nuevo' | 'contactado' | 'cotizado' | 'convertido' | 'descartado'

export interface ProspectNote { text: string; at: string }

// Seeds CLARAMENTE de muestra (prefijo "(Muestra)") — no son leads reales de
// Renovacell; existen solo para que el pipeline se vea poblado.
const SEED: Prospect[] = [
  {
    id: 'pr-sample-1', name: '(Muestra) Dra. Ana López', email: 'ana.lopez@ejemplo.mx',
    phone: '55 0000 0001', cedula: null, source: 'Landing', status: 'nuevo', assigned_to: null,
    created_at: '2026-06-16T17:30:00.000Z',
    meta: { organization: 'Clínica Ejemplo', interest: ['Golden Serum'], notes: [] },
  },
  {
    id: 'pr-sample-2', name: '(Muestra) Dr. Beto Ramírez', email: 'beto@ejemplo.mx',
    phone: '55 0000 0002', cedula: null, source: 'WhatsApp', status: 'contactado', assigned_to: null,
    created_at: '2026-06-12T15:10:00.000Z',
    meta: {
      organization: 'Estética Demo', interest: ['Mascarilla GP'],
      notes: [{ text: 'Pidió info por WhatsApp; le interesa Home Care.', at: '2026-06-13T16:00:00.000Z' }],
    },
  },
  {
    id: 'pr-sample-3', name: '(Muestra) Dra. Carmen Soto', email: 'carmen@ejemplo.mx',
    phone: '55 0000 0003', cedula: null, source: 'Referido', status: 'cotizado', assigned_to: null,
    created_at: '2026-06-09T18:45:00.000Z',
    meta: { organization: 'Consultorio Prueba', interest: ['Ultrafiltrados UFS'], notes: [] },
  },
]

let prospects: Prospect[] = [...SEED]
const listeners = new Set<() => void>()
let snapshot: Prospect[] = [...prospects]
let seq = 0

function emit() {
  snapshot = [...prospects]
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): Prospect[] => snapshot

export function addProspect(input: {
  name: string
  email: string | null
  phone: string | null
  organization: string | null
  source: string
  interest: string[]
}): Prospect {
  seq += 1
  const p: Prospect = {
    id: `pr-new-${seq}`,
    name: input.name,
    email: input.email,
    phone: input.phone,
    cedula: null,
    source: input.source,
    status: 'nuevo',
    assigned_to: null,
    created_at: new Date().toISOString(),
    meta: { organization: input.organization, interest: input.interest, notes: [] },
  }
  prospects = [p, ...prospects]
  emit()
  notify({ text: `Nuevo prospecto: ${p.name}`, roles: ['admin'], screen: 'av_prosp' })
  return p
}

export function setStatus(id: string, status: ProspectStatus) {
  prospects = prospects.map((p) => (p.id === id ? { ...p, status } : p))
  emit()
}

export function addNote(id: string, text: string) {
  const note: ProspectNote = { text, at: new Date().toISOString() }
  prospects = prospects.map((p) => {
    if (p.id !== id) return p
    const meta = (p.meta ?? {}) as Record<string, unknown>
    const notes = [...((meta.notes as ProspectNote[]) ?? []), note]
    return { ...p, meta: { ...meta, notes } }
  })
  emit()
}

// Marca convertido y enlaza el doctor creado (para no convertir dos veces).
export function markConverted(id: string, doctorId: string) {
  prospects = prospects.map((p) => {
    if (p.id !== id) return p
    const meta = (p.meta ?? {}) as Record<string, unknown>
    return { ...p, status: 'convertido', meta: { ...meta, convertedDoctorId: doctorId } }
  })
  emit()
}

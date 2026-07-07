// Store de PROSPECTOS (leads · PII staff-only). Con backend hidrata de la tabla
// `prospects` (RLS: vendedor ve los suyos por assigned_to = auth.uid(); admin/comm
// todos) y las mutaciones escriben write-through. Sin backend, opera sobre seeds
// de muestra. La captura pública desde la landing se conectará vía función.
import type { Prospect } from '../types'
import { notify } from './notificationsStore'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import { makeLive } from './live'
import type { Json } from '../database.types'

export type ProspectStatus = 'nuevo' | 'contactado' | 'cotizado' | 'convertido' | 'descartado'
export interface ProspectNote { text: string; at: string }

const SEED: Prospect[] = [
  { id: 'pr-sample-1', name: '(Muestra) Dra. Ana López', email: 'ana.lopez@ejemplo.mx', phone: '55 0000 0001', cedula: null, source: 'Landing', status: 'nuevo', assigned_to: 'ventas1@renovacell.mx', created_at: '2026-06-16T17:30:00.000Z', meta: { organization: 'Clínica Ejemplo', interest: ['Golden Serum'], notes: [] } },
  { id: 'pr-sample-2', name: '(Muestra) Dr. Beto Ramírez', email: 'beto@ejemplo.mx', phone: '55 0000 0002', cedula: null, source: 'WhatsApp', status: 'contactado', assigned_to: 'ventas2@renovacell.mx', created_at: '2026-06-12T15:10:00.000Z', meta: { organization: 'Estética Demo', interest: ['Mascarilla GP'], notes: [{ text: 'Pidió info por WhatsApp; le interesa Home Care.', at: '2026-06-13T16:00:00.000Z' }] } },
  { id: 'pr-sample-3', name: '(Muestra) Dra. Carmen Soto', email: 'carmen@ejemplo.mx', phone: '55 0000 0003', cedula: null, source: 'Referido', status: 'cotizado', assigned_to: 'ventas1@renovacell.mx', created_at: '2026-06-09T18:45:00.000Z', meta: { organization: 'Consultorio Prueba', interest: ['Ultrafiltrados UFS'], notes: [] } },
]

const live = makeLive<Prospect>(async () => {
  const { data, error } = await supabase.from('prospects')
    .select('id, name, email, phone, cedula, source, status, assigned_to, created_at, meta')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Prospect[]
}, SEED)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

let seq = 0

export function addProspect(input: {
  name: string
  email: string | null
  phone: string | null
  organization: string | null
  source: string
  interest: string[]
  cedula?: string | null
  assignedTo?: string | null
}): Prospect {
  seq += 1
  const assigned = hasSupabase ? (input.assignedTo ? currentUserId() : null) : (input.assignedTo ?? null)
  const meta = { organization: input.organization, interest: input.interest, notes: [] as ProspectNote[] }
  const p: Prospect = {
    id: hasSupabase ? (globalThis.crypto?.randomUUID?.() ?? `pr-new-${seq}`) : `pr-new-${seq}`,
    name: input.name, email: input.email, phone: input.phone, cedula: input.cedula ?? null,
    source: input.source, status: 'nuevo', assigned_to: assigned, created_at: new Date().toISOString(), meta,
  }
  live.setLocal([p, ...live.current()])
  notify({ text: `Nuevo prospecto: ${p.name}`, roles: ['admin'], screen: 'av_prosp' })
  if (hasSupabase) {
    supabase.from('prospects').insert({
      id: p.id, name: p.name, email: p.email, phone: p.phone, cedula: p.cedula,
      source: p.source, status: 'nuevo', assigned_to: assigned, meta: meta as unknown as Json,
    }).then(({ error }) => { if (error) console.warn('[prospects] insert', error.message); live.reload() })
  }
  return p
}

export function setStatus(id: string, status: ProspectStatus) {
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, status } : p)))
  if (hasSupabase) supabase.from('prospects').update({ status }).eq('id', id).then(({ error }) => { if (error) console.warn('[prospects] status', error.message); live.reload() })
}

export function addNote(id: string, text: string) {
  const note: ProspectNote = { text, at: new Date().toISOString() }
  const cur = live.current().find((p) => p.id === id)
  const meta = { ...((cur?.meta ?? {}) as Record<string, unknown>) }
  meta.notes = [...(((meta.notes as ProspectNote[]) ?? [])), note]
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, meta } : p)))
  if (hasSupabase) supabase.from('prospects').update({ meta: meta as unknown as Json }).eq('id', id).then(({ error }) => { if (error) console.warn('[prospects] note', error.message); live.reload() })
}

// Editar datos del prospecto (nombre, contacto, organización, interés).
export function updateProspect(id: string, patch: { name?: string; email?: string | null; phone?: string | null; organization?: string | null; interest?: string[] }) {
  const cur = live.current().find((p) => p.id === id)
  if (!cur) return
  const meta = { ...((cur.meta ?? {}) as Record<string, unknown>) }
  if (patch.organization !== undefined) meta.organization = patch.organization
  if (patch.interest !== undefined) meta.interest = patch.interest
  const next = {
    ...cur,
    name: patch.name ?? cur.name,
    email: patch.email !== undefined ? patch.email : cur.email,
    phone: patch.phone !== undefined ? patch.phone : cur.phone,
    meta,
  }
  live.setLocal(live.current().map((p) => (p.id === id ? next : p)))
  if (hasSupabase) supabase.from('prospects').update({ name: next.name, email: next.email, phone: next.phone, meta: meta as unknown as Json }).eq('id', id).then(({ error }) => { if (error) console.warn('[prospects] update', error.message); live.reload() })
}

// Eliminar prospecto (solo admin por RLS: prospects_delete_admin).
export async function deleteProspect(id: string): Promise<{ ok: boolean; error?: string }> {
  live.setLocal(live.current().filter((p) => p.id !== id))
  if (hasSupabase) {
    const { error } = await supabase.from('prospects').delete().eq('id', id)
    if (error) { await live.reload(); return { ok: false, error: error.message } }
    await live.reload()
  }
  return { ok: true }
}

export function markConverted(id: string, doctorId: string) {
  const cur = live.current().find((p) => p.id === id)
  const meta = { ...((cur?.meta ?? {}) as Record<string, unknown>), convertedDoctorId: doctorId }
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, status: 'convertido', meta } : p)))
  if (hasSupabase) supabase.from('prospects').update({ status: 'convertido', meta: meta as unknown as Json }).eq('id', id).then(({ error }) => { if (error) console.warn('[prospects] convert', error.message); live.reload() })
}

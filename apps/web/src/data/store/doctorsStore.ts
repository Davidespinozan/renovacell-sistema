// Store de doctores (perfiles con role_id='doctor'). Con backend hidrata de
// `profiles` (RLS: admin y staff operativo ven a los doctores/clientes; nadie ve
// PII de otro staff) y verify/revoke/cédula escriben write-through (solo admin por
// RLS + profiles_guard). El alta por conversión de prospecto queda local hasta el
// flujo de invitación (un doctor es un usuario de auth). El hook no cambia.
import type { Profile } from '../types'
import { MOCK_DOCTORS } from '../mock/doctores'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'
import type { Json } from '../database.types'

const isUuid = (s: string | null | undefined): boolean => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

const live = makeLive<Profile>(async () => {
  const { data, error } = await supabase.from('profiles')
    .select('id, email, full_name, role_id, verified, organization, meta')
    .eq('role_id', 'doctor')
    .order('full_name')
  if (error) throw error
  return (data ?? []) as unknown as Profile[]
}, MOCK_DOCTORS)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

export function verifiedByEmail(email: string): boolean | undefined {
  return live.current().find((d) => d.email?.toLowerCase() === email.trim().toLowerCase())?.verified
}

export function setVerified(id: string, verified: boolean): boolean {
  const doc = live.current().find((d) => d.id === id)
  if (!doc) return false
  if (verified && !((doc.meta?.cedula as string) ?? '').trim()) return false // gate: sin cédula no se verifica
  live.setLocal(live.current().map((d) => (d.id === id ? { ...d, verified } : d)))
  logAudit({ actor: 'Administración', action: verified ? 'Doctor verificado' : 'Acceso revocado', resource: doc.full_name ?? id })
  if (hasSupabase && isUuid(id)) supabase.from('profiles').update({ verified }).eq('id', id).then(({ error }) => { if (error) console.warn('[doctors] verify', error.message); live.reload() })
  return true
}

export function setCedula(id: string, cedula: string) {
  const doc = live.current().find((d) => d.id === id)
  if (!doc) return
  const meta = { ...((doc.meta ?? {}) as Record<string, unknown>), cedula: cedula.trim() }
  live.setLocal(live.current().map((d) => (d.id === id ? { ...d, meta } : d)))
  logAudit({ actor: 'Administración', action: 'Cédula registrada', resource: doc.full_name ?? id })
  if (hasSupabase && isUuid(id)) supabase.from('profiles').update({ meta: meta as unknown as Json }).eq('id', id).then(({ error }) => { if (error) console.warn('[doctors] cedula', error.message); live.reload() })
}

// Editar datos del doctor (nombre, organización). Admin por RLS/guard.
export function updateDoctor(id: string, patch: { full_name?: string; organization?: string | null }) {
  const cur = live.current().find((d) => d.id === id)
  if (!cur) return
  const meta = { ...((cur.meta ?? {}) as Record<string, unknown>) }
  if (patch.full_name != null) meta.name = patch.full_name
  const next = { ...cur, full_name: patch.full_name ?? cur.full_name, organization: patch.organization !== undefined ? patch.organization : cur.organization, meta }
  live.setLocal(live.current().map((d) => (d.id === id ? next : d)))
  logAudit({ actor: 'Administración', action: 'Doctor editado', resource: next.full_name ?? id })
  if (hasSupabase && isUuid(id)) supabase.from('profiles').update({ full_name: next.full_name, organization: next.organization, meta: meta as unknown as Json }).eq('id', id).then(({ error }) => { if (error) console.warn('[doctors] update', error.message); live.reload() })
}

// Eliminar un doctor. Es un usuario de auth → se borra vía la Edge Function
// `staff-admin` (service role, solo admin). Los locales (sin persistir) se quitan
// de la lista sin más.
export async function deleteDoctor(id: string): Promise<{ ok: boolean; error?: string }> {
  const cur = live.current().find((d) => d.id === id)
  live.setLocal(live.current().filter((d) => d.id !== id))
  logAudit({ actor: 'Administración', action: 'Doctor eliminado', resource: cur?.full_name ?? id })
  if (hasSupabase && isUuid(id)) {
    const { data, error } = await supabase.functions.invoke('staff-admin', { body: { action: 'delete', id } })
    let err = error?.message ?? (data as { error?: string } | null)?.error
    // FK con orders.doctor_id: el doctor tiene pedidos en su historial → mensaje claro.
    if (err && /foreign key|violates|constraint|orders/i.test(err)) {
      err = 'No se puede eliminar: el doctor tiene pedidos en su historial. Revócale el acceso en su lugar.'
    }
    if (err) { await live.reload(); return { ok: false, error: err } }
    await live.reload()
  }
  return { ok: true }
}

export function inviteDoctor(id: string) {
  const doc = live.current().find((d) => d.id === id)
  if (!doc) return
  const meta = { ...((doc.meta ?? {}) as Record<string, unknown>), invited: true }
  live.setLocal(live.current().map((d) => (d.id === id ? { ...d, meta } : d)))
  notify({ text: `Acceso al Portal enviado a ${doc.full_name}`, roles: ['admin'], screen: 'av_doc' })
  logAudit({ actor: 'Administración', action: 'Acceso al Portal enviado', resource: doc.full_name ?? id })
  if (hasSupabase && isUuid(id)) supabase.from('profiles').update({ meta: meta as unknown as Json }).eq('id', id).then(() => live.reload())
  // Nota: la invitación real (crear usuario de auth + enlace mágico) es acción
  // server-side (admin API / Edge Function) que se conecta en la fase de correo.
}

// Alta como PENDIENTE (conversión de prospecto). Un doctor es un usuario de auth:
// con backend, la Edge Function `invite-doctor` (service role, solo admin) lo crea
// de verdad y persiste el perfil; aquí lo agregamos optimista y al confirmar
// recargamos para traer el doctor real (uuid). Sin correo del prospecto no se puede
// crear el usuario → queda local (se persiste cuando se capture un correo).
let newSeq = 0
export function addDoctor(input: {
  full_name: string
  email: string | null
  organization: string | null
  meta?: Record<string, unknown>
}): Profile {
  newSeq += 1
  const doc: Profile = {
    id: `doctor-new-${newSeq}`, email: input.email, full_name: input.full_name,
    role_id: 'doctor', verified: false, organization: input.organization, meta: input.meta ?? {},
  }
  live.setLocal([doc, ...live.current()])
  notify({ text: `Doctor por verificar: ${doc.full_name}`, roles: ['admin'], screen: 'av_doc' })
  if (hasSupabase && input.email) {
    supabase.functions.invoke('invite-doctor', {
      body: { email: input.email, full_name: input.full_name, organization: input.organization, meta: input.meta ?? {} },
    }).then(({ error }) => {
      if (error) { console.warn('[doctors] invite-doctor', error.message); return }
      live.reload() // reemplaza el optimista por el doctor real persistido
    })
  }
  return doc
}

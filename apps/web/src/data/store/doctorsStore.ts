// Store compartido de doctores (perfiles). El admin verifica/revoca; el cambio
// se refleja en lista y detalle. Al migrar a Supabase: update de profiles.verified
// (y la RLS hará cumplir el gate de ordenar). El hook useDoctors no cambia.
import type { Profile } from '../types'
import { MOCK_DOCTORS } from '../mock/doctores'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'

let doctors: Profile[] = [...MOCK_DOCTORS]
const listeners = new Set<() => void>()
let snapshot: Profile[] = [...doctors]

function emit() {
  snapshot = [...doctors]
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): Profile[] => snapshot

// Verificación VIVA del doctor (la usa el login): si Admin lo revoca/deja
// pendiente, el acceso se bloquea de inmediato. undefined = no es doctor del store.
export function verifiedByEmail(email: string): boolean | undefined {
  return doctors.find((d) => d.email?.toLowerCase() === email.trim().toLowerCase())?.verified
}

export function setVerified(id: string, verified: boolean): boolean {
  const doc = doctors.find((d) => d.id === id)
  if (!doc) return false
  // No se puede verificar sin cédula profesional registrada (gate regulatorio).
  if (verified && !((doc.meta?.cedula as string) ?? '').trim()) return false
  doctors = doctors.map((d) => (d.id === id ? { ...d, verified } : d))
  emit()
  logAudit({ actor: 'Administración', action: verified ? 'Doctor verificado' : 'Acceso revocado', resource: doc.full_name ?? id })
  return true
}

// Registrar/actualizar la cédula profesional (requisito para verificar). Sin
// esto, un doctor creado por conversión de prospecto nunca podría verificarse.
export function setCedula(id: string, cedula: string) {
  const doc = doctors.find((d) => d.id === id)
  if (!doc) return
  doctors = doctors.map((d) => (d.id === id ? { ...d, meta: { ...(d.meta ?? {}), cedula: cedula.trim() } } : d))
  emit()
  logAudit({ actor: 'Administración', action: 'Cédula registrada', resource: doc.full_name ?? id })
}

// Enviar acceso al Portal: invita al doctor (verificado) a entrar a su portal.
// Hoy mock (marca invited + audita). Con backend: crea su usuario de auth y le
// envía invitación / enlace mágico por correo. La firma no cambia.
export function inviteDoctor(id: string) {
  const doc = doctors.find((d) => d.id === id)
  if (!doc) return
  doctors = doctors.map((d) => (d.id === id ? { ...d, meta: { ...(d.meta ?? {}), invited: true } } : d))
  emit()
  notify({ text: `Acceso al Portal enviado a ${doc.full_name}`, roles: ['admin'], screen: 'av_doc' })
  logAudit({ actor: 'Administración', action: 'Acceso al Portal enviado', resource: doc.full_name ?? id })
}

// Alta de doctor en estado PENDIENTE (verified:false). La usa la conversión de
// Prospectos: cierra el embudo landing→prospecto→doctor→Portal sin duplicar el
// concepto de Doctores. En Supabase = insert en profiles (role_id='doctor',
// verified=false); luego el admin lo verifica con setVerified.
let newSeq = 0
export function addDoctor(input: {
  full_name: string
  email: string | null
  organization: string | null
  meta?: Record<string, unknown>
}): Profile {
  newSeq += 1
  const doc: Profile = {
    id: `doctor-new-${newSeq}`,
    email: input.email,
    full_name: input.full_name,
    role_id: 'doctor',
    verified: false,
    organization: input.organization,
    meta: input.meta ?? {},
  }
  doctors = [doc, ...doctors]
  emit()
  notify({ text: `Doctor por verificar: ${doc.full_name}`, roles: ['admin'], screen: 'av_doc' })
  return doc
}

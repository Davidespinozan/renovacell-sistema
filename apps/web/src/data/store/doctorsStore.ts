// Store compartido de doctores (perfiles). El admin verifica/revoca; el cambio
// se refleja en lista y detalle. Al migrar a Supabase: update de profiles.verified
// (y la RLS hará cumplir el gate de ordenar). El hook useDoctors no cambia.
import type { Profile } from '../types'
import { MOCK_DOCTORS } from '../mock/doctores'

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

export function setVerified(id: string, verified: boolean) {
  doctors = doctors.map((d) => (d.id === id ? { ...d, verified } : d))
  emit()
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
  return doc
}

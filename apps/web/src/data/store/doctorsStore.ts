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

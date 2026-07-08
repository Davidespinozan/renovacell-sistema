// Hook de acceso a doctores. HOY store mock; MAÑANA Supabase (profiles con
// role_id='doctor'); verify/revoke = update de profiles.verified (solo admin por RLS).
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, setVerified, setCedula, inviteDoctor, addDoctor, updateDoctor, deleteDoctor, autoVerify } from '../store/doctorsStore'

export function useDoctors() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    data,
    loading: false,
    error: null as string | null,
    verify: (id: string) => setVerified(id, true),
    revoke: (id: string) => setVerified(id, false),
    setCedula,
    inviteDoctor,
    updateDoctor,
    deleteDoctor,
    autoVerify,
    // Alta como PENDIENTE (la usa Prospectos al convertir).
    addPending: addDoctor,
  }
}

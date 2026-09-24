// Hook de acceso a doctores. HOY store mock; MAÑANA Supabase (profiles con
// role_id='doctor'); verify/revoke = update de profiles.verified (solo admin por RLS).
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, setVerified, setCedula, setPriceList, inviteDoctor, addDoctor, updateDoctor, deleteDoctor, autoVerify, approveDoctor, rejectDoctor, revokeDoctor } from '../store/doctorsStore'

export function useDoctors() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    data,
    loading: false,
    error: null as string | null,
    // Revisión humana (Fase 1): aprobar exige resolver customer; rechazar guarda razón.
    approve: approveDoctor,
    reject: rejectDoctor,
    revoke: revokeDoctor,
    // `verify` directo se conserva para la auto-verificación IA (sin customer). El cockpit
    // usa `approve` (con customer). No se usa para la aprobación manual del admin.
    verify: (id: string) => setVerified(id, true),
    setCedula,
    setPriceList,
    inviteDoctor,
    updateDoctor,
    deleteDoctor,
    autoVerify,
    // Alta como PENDIENTE (la usa Prospectos al convertir).
    addPending: addDoctor,
  }
}

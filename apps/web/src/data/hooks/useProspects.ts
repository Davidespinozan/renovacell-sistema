// Hook de acceso a prospectos (leads). HOY store mock; MAÑANA Supabase
// (select/insert/update sobre prospects con RLS staff-only). La pantalla no cambia.
import { useSyncExternalStore } from 'react'
import {
  subscribe, getSnapshot, addProspect, setStatus, addNote, markConverted, updateProspect, deleteProspect,
  type ProspectStatus, type ProspectNote,
} from '../store/prospectsStore'

export function useProspects() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    data,
    loading: false,
    error: null as string | null,
    addProspect,
    setStatus,
    addNote,
    markConverted,
    updateProspect,
    deleteProspect,
  }
}

export type { ProspectStatus, ProspectNote }

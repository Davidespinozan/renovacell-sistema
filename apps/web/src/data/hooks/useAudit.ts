// Hook de la bitácora de auditoría (solo lectura). Mock hoy; con Supabase = select
// sobre audit_logs (insert-only). La pantalla no cambia.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, type AuditEntry } from '../store/auditStore'

export function useAudit() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data }
}

export type { AuditEntry }

// Directorio de usuarios. `staffOnly` acota a staff (el chat lo usa así). Con
// backend, el staff sale de `profiles` (vía teamStore, ya filtrado por RLS: admin/
// staff; los doctores NO aparecen para chatear). Sin backend, usa el mock.
import { useSyncExternalStore } from 'react'
import { MOCK_USERS, type DirectoryUser } from '../mock/users'
import { hasSupabase, currentUserId } from '../../lib/supabase'
import { subscribe, getSnapshot } from '../store/teamStore'
import { getRole } from '../../app/roles'

export function useUsers(opts?: { staffOnly?: boolean }): { data: DirectoryUser[] } {
  const team = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!hasSupabase) {
    const data = opts?.staffOnly ? MOCK_USERS.filter((u) => u.isStaff) : MOCK_USERS
    return { data }
  }
  // Staff real (excluye al propio usuario y a los inactivos).
  const me = currentUserId()
  const data: DirectoryUser[] = team
    .filter((u) => u.active && u.id !== me)
    .map((u) => ({ id: u.id, name: u.name, role: getRole(u.role).label, isStaff: true, avatarUrl: u.avatarUrl }))
  return { data }
}

export type { DirectoryUser }

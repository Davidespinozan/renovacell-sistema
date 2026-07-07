// Directorio de usuarios. `staffOnly` acota a staff (el chat lo usa así). Con
// backend, sale de la vista segura `staff_directory` (todo el staff: nombre + foto
// + rol, sin PII) — así CUALQUIER staff ve a todos para chatear, no solo el admin.
// Los doctores NO aparecen. Sin backend, usa el mock.
import { useSyncExternalStore } from 'react'
import { MOCK_USERS, type DirectoryUser } from '../mock/users'
import { hasSupabase, currentUserId } from '../../lib/supabase'
import { subscribe, getSnapshot } from '../store/directoryStore'
import { getRole } from '../../app/roles'

export function useUsers(opts?: { staffOnly?: boolean }): { data: DirectoryUser[] } {
  const dir = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!hasSupabase) {
    const data = opts?.staffOnly ? MOCK_USERS.filter((u) => u.isStaff) : MOCK_USERS
    return { data }
  }
  const me = currentUserId()
  const data: DirectoryUser[] = dir
    .filter((u) => u.id !== me)
    .map((u) => ({ id: u.id, name: u.name, role: getRole(u.role).label, isStaff: true, avatarUrl: u.avatarUrl }))
  return { data }
}

export type { DirectoryUser }

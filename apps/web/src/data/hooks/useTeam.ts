// Hook del equipo (Admin). Mock hoy; con Supabase = profiles + user_capabilities.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, addUser, toggleCapability, setActive, type TeamUser } from '../store/teamStore'

export function useTeam() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, addUser, toggleCapability, setActive }
}

export type { TeamUser }

// Hook del equipo (Admin). Con backend, las mutaciones que crean/editan/eliminan
// usuarios o fijan contraseñas pasan por la Edge Function `staff-admin` (service
// role, solo admin). Las capabilities/suspensión se persisten en profiles.meta.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, addUser, updateUser, removeUser, setPassword, toggleCapability, setActive, type TeamUser } from '../store/teamStore'

export function useTeam() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, addUser, updateUser, removeUser, setPassword, toggleCapability, setActive }
}

export type { TeamUser }

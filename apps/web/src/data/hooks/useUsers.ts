// Directorio de usuarios. `staffOnly` acota a staff (el chat lo usa así), para
// que mañana el select sobre profiles nazca filtrado por RLS sin reescribir la UI.
import { MOCK_USERS, type DirectoryUser } from '../mock/users'

export function useUsers(opts?: { staffOnly?: boolean }): { data: DirectoryUser[] } {
  const data = opts?.staffOnly ? MOCK_USERS.filter((u) => u.isStaff) : MOCK_USERS
  return { data }
}

export type { DirectoryUser }

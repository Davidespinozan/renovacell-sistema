// Directorio de usuarios para abrir chats. HOY mock; MAÑANA select sobre profiles.
import { MOCK_USERS, type DirectoryUser } from '../mock/users'

export function useUsers(): { data: DirectoryUser[] } {
  return { data: MOCK_USERS }
}

export type { DirectoryUser }

// DIRECTORIO de staff (para el chat y anuncios): nombre + foto + rol de TODO el
// equipo, leído de la vista segura `staff_directory` (sin PII). A diferencia de
// teamStore (solo admin, datos completos), esto lo puede leer cualquier staff, así
// que el chat lista a todos y pinta sus avatares. Los doctores no ven nada (RLS/vista).
import type { RoleKey } from '../../app/roles'
import { supabase } from '../../lib/supabase'
import { ROLE_MAP } from '../../auth/supabaseAuth'
import { makeLive } from './live'

export interface DirEntry {
  id: string
  name: string
  role: RoleKey
  avatarUrl?: string
}

const live = makeLive<DirEntry>(async () => {
  const { data, error } = await supabase.from('staff_directory').select('id, name, avatar_url, role_id')
  if (error) throw error
  return (data ?? []).map((d) => ({
    id: d.id as string,
    name: (d.name as string) ?? 'Usuario',
    role: ROLE_MAP[(d.role_id as string) ?? 'admin'] ?? 'admin',
    avatarUrl: (d.avatar_url as string | null) ?? undefined,
  }))
}, [])

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot
// Búsqueda rápida por id (para resolver el avatar del autor de un anuncio, etc.).
export const avatarByIdMap = (): Record<string, string | undefined> =>
  Object.fromEntries(live.getSnapshot().map((d) => [d.id, d.avatarUrl]))

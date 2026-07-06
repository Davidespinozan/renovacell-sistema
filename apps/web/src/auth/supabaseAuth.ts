// Puente de autenticación con Supabase Auth + perfil (profiles).
// Traduce el perfil de la base a la forma que espera la app (rol/verificado/caps).
// La seguridad real la impone el RLS; aquí solo mapeamos.
import { supabase } from '../lib/supabase'
import type { RoleKey } from '../app/roles'

// La base tiene 8 roles; la app usa 5. Mapeo seguro (packing→almacén, billing/comm→admin).
const ROLE_MAP: Record<string, RoleKey> = {
  admin: 'admin', doctor: 'doctor', warehouse: 'warehouse', packing: 'warehouse',
  pos: 'pos', billing: 'admin', comm: 'admin', driver: 'driver',
}

export interface Session {
  role: RoleKey
  verified: boolean
  name: string
  email: string
  capabilities: string[]
}

function toSessionRow(row: { role_id: string | null; verified: boolean | null; full_name: string | null; meta: unknown }, email: string): Session {
  const meta = (row.meta ?? {}) as { capabilities?: string[]; name?: string }
  return {
    role: ROLE_MAP[row.role_id ?? 'doctor'] ?? 'doctor',
    verified: Boolean(row.verified),
    name: meta.name ?? row.full_name ?? email,
    email,
    capabilities: meta.capabilities ?? [],
  }
}

async function fetchProfile(userId: string, email: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('role_id, verified, full_name, meta')
    .eq('id', userId)
    .single()
  if (error || !data) return null
  return toSessionRow(data, email)
}

export async function signInSupabase(email: string, password: string): Promise<{ session?: Session; error?: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) {
    const m = /invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.' : error.message
    return { error: m }
  }
  const session = await fetchProfile(data.user.id, data.user.email ?? email)
  if (!session) return { error: 'No se encontró tu perfil. Contacta a Administración.' }
  return { session }
}

// Sesión activa al recargar (si hay una guardada). Devuelve null si no hay.
export async function currentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  const u = data.session?.user
  if (!u) return null
  return fetchProfile(u.id, u.email ?? '')
}

export async function signOutSupabase(): Promise<void> {
  await supabase.auth.signOut()
}

// Recuperación de contraseña (envía el correo real de restablecimiento).
export async function resetPasswordSupabase(email: string): Promise<void> {
  await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/`,
  })
}

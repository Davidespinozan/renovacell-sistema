// Puente de autenticación con Supabase Auth + perfil (profiles).
// Traduce el perfil de la base a la forma que espera la app (rol/verificado/caps).
// La seguridad real la impone el RLS; aquí solo mapeamos.
import { supabase } from '../lib/supabase'
import type { RoleKey } from '../app/roles'
import { atenderSuspension, CUENTA_SUSPENDIDA_MSG } from './suspension'

// La base tiene 8 roles; la app usa 5. Mapeo seguro (packing→almacén, billing/comm→admin).
export const ROLE_MAP: Record<string, RoleKey> = {
  admin: 'admin', doctor: 'doctor', warehouse: 'warehouse', packing: 'warehouse',
  pos: 'pos', billing: 'admin', comm: 'admin', driver: 'driver',
}

export interface Session {
  role: RoleKey
  verified: boolean
  name: string
  email: string
  capabilities: string[]
  avatarUrl?: string
}

function toSessionRow(row: { role_id: string | null; verified: boolean | null; full_name: string | null; meta: unknown }, email: string): Session {
  const meta = (row.meta ?? {}) as { capabilities?: string[]; name?: string; avatar_url?: string }
  return {
    role: ROLE_MAP[row.role_id ?? 'doctor'] ?? 'doctor',
    verified: Boolean(row.verified),
    name: meta.name ?? row.full_name ?? email,
    email,
    capabilities: meta.capabilities ?? [],
    avatarUrl: meta.avatar_url ?? undefined,
  }
}

// Resultado de leer el perfil: la sesión, `null` si no hay perfil, o 'suspendida' si el
// servidor negó la lectura con CUENTA_SUSPENDIDA o el perfil trae active = false.
async function fetchProfile(userId: string, email: string): Promise<Session | null | 'suspendida'> {
  const { data, error } = await supabase
    .from('profiles')
    .select('role_id, verified, full_name, meta, active')
    .eq('id', userId)
    .single()
  if (error) return atenderSuspension(error.message) ? 'suspendida' : null
  if (!data) return null
  if (data.active === false) return 'suspendida'
  return toSessionRow(data, email)
}

export async function signInSupabase(email: string, password: string): Promise<{ session?: Session; error?: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) {
    const m = /invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.' : error.message
    return { error: m }
  }
  const session = await fetchProfile(data.user.id, data.user.email ?? email)
  if (session === 'suspendida') {
    // W6-A1: la cuenta existe pero Dirección la suspendió. Sin sesión colgada.
    await supabase.auth.signOut()
    return { error: CUENTA_SUSPENDIDA_MSG }
  }
  if (!session) {
    // #9: no dejar una sesión autenticada colgada si el perfil no existe.
    await supabase.auth.signOut()
    return { error: 'No se encontró tu perfil. Contacta a Administración.' }
  }
  return { session }
}

// Sesión activa al recargar (si hay una guardada). Devuelve null si no hay.
export async function currentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  const u = data.session?.user
  if (!u) return null
  const s = await fetchProfile(u.id, u.email ?? '')
  if (s === 'suspendida') {
    // Sesión guardada de una cuenta que ya fue suspendida: se cierra y se avisa.
    await supabase.auth.signOut()
    return null
  }
  return s
}

export async function signOutSupabase(): Promise<void> {
  await supabase.auth.signOut()
}

// Recuperación de contraseña (envía el correo real de restablecimiento).
export async function resetPasswordSupabase(email: string): Promise<void> {
  await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/sistema`,
  })
}

// Cliente de Supabase (frontend).
// Usa SOLO la anon key (pública); la service_role JAMÁS va aquí — la seguridad
// real la impone el RLS default-deny en la base. Las variables viven en
// apps/web/.env.local (gitignoreado); en producción se inyectan en el build.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../data/database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  // No rompemos el arranque (la app sigue en modo mock si falta), pero avisamos.
  console.warn('[supabase] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en apps/web/.env.local — la app opera en modo mock.')
}

export const supabase = createClient<Database>(url ?? '', anonKey ?? '', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

// Bandera para que los hooks decidan si ya hay backend conectado.
export const hasSupabase = Boolean(url && anonKey)

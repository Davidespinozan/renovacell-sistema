import { createClient } from '@supabase/supabase-js'

// Read Vite environment variables. Do NOT hardcode keys here.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail fast in dev if env vars missing — helpful during local setup.
  console.warn('[supabaseClient] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(String(SUPABASE_URL), String(SUPABASE_ANON_KEY))

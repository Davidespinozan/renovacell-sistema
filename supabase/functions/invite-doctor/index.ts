// Edge Function: ALTA/INVITACIÓN de doctor (server-side).
// Un doctor es un usuario de auth: crearlo requiere el service role, que NUNCA
// puede vivir en el cliente. Esta función lo hace del lado del servidor y SOLO si
// quien la invoca es admin. Persiste al doctor (profile role_id='doctor',
// verified=false) para que no se pierda al recargar. El envío del enlace de acceso
// (magic link) queda para cuando haya SMTP configurado (fase de correo).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  // 1) Identifica a quien llama por su JWT.
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })

  const admin = createClient(url, service, { auth: { persistSession: false } })

  // 2) Solo un admin puede dar de alta doctores.
  const { data: prof } = await admin.from('profiles').select('role_id').eq('id', who.user.id).single()
  if (prof?.role_id !== 'admin') return json(403, { error: 'Solo Administración puede dar de alta doctores.' })

  // 3) Datos del doctor.
  let payload: { email?: string; full_name?: string; organization?: string; meta?: Record<string, unknown> }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const email = (payload.email ?? '').trim().toLowerCase()
  if (!email) return json(400, { error: 'Falta el correo del doctor.' })

  // 4) ¿Ya existe ese correo? Reutiliza el usuario en vez de duplicar.
  let userId: string | null = null
  const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
  if (existing) {
    userId = existing.id
  } else {
    // Crea el usuario de auth (sin enviar correo: el enlace de acceso es fase SMTP).
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { name: payload.full_name ?? '' },
    })
    if (cErr || !created?.user) return json(400, { error: cErr?.message ?? 'No se pudo crear el usuario.' })
    userId = created.user.id
  }

  // 5) Persiste/actualiza el perfil como doctor PENDIENTE (verified=false).
  const { error: pErr } = await admin.from('profiles').upsert({
    id: userId, email, full_name: payload.full_name ?? null, role_id: 'doctor',
    verified: false, organization: payload.organization ?? null,
    meta: { ...(payload.meta ?? {}), invited: true },
  })
  if (pErr) return json(400, { error: pErr.message })

  return json(200, { id: userId, email, ok: true })
})

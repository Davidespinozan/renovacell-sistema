// Edge Function: gestión de USUARIOS del equipo (staff) — server-side.
// Crear/editar/eliminar un usuario y fijar su contraseña requiere el service role
// (nunca en el cliente). Todas las acciones exigen que quien invoca sea ADMIN.
// Acciones: create | setPassword | update | delete.
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

  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: prof } = await admin.from('profiles').select('role_id').eq('id', who.user.id).single()
  if (prof?.role_id !== 'admin') return json(403, { error: 'Solo Administración puede gestionar usuarios.' })

  let body: {
    action?: string; id?: string; email?: string; password?: string
    full_name?: string; role?: string; capabilities?: string[]
  }
  try { body = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = body.action

  // No permitir que un admin se elimine/degrade a sí mismo (evita quedarse sin acceso).
  if ((action === 'delete' || (action === 'update' && body.role && body.role !== 'admin')) && body.id === who.user.id) {
    return json(400, { error: 'No puedes eliminar ni cambiar tu propio rol de administrador.' })
  }

  if (action === 'create') {
    const email = (body.email ?? '').trim().toLowerCase()
    const password = body.password ?? ''
    if (!email) return json(400, { error: 'Falta el correo.' })
    if (password.length < 6) return json(400, { error: 'La contraseña debe tener al menos 6 caracteres.' })
    const { data: exists } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
    if (exists) return json(400, { error: 'Ya existe un usuario con ese correo.' })
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name: body.full_name ?? '' },
    })
    if (cErr || !created?.user) return json(400, { error: cErr?.message ?? 'No se pudo crear el usuario.' })
    const { error: pErr } = await admin.from('profiles').upsert({
      id: created.user.id, email, full_name: body.full_name ?? null, role_id: body.role ?? 'warehouse',
      verified: true, meta: { name: body.full_name ?? '', capabilities: body.capabilities ?? [] },
    })
    if (pErr) return json(400, { error: pErr.message })
    return json(200, { ok: true, id: created.user.id })
  }

  if (action === 'setPassword') {
    if (!body.id) return json(400, { error: 'Falta el id del usuario.' })
    if ((body.password ?? '').length < 6) return json(400, { error: 'La contraseña debe tener al menos 6 caracteres.' })
    const { error } = await admin.auth.admin.updateUserById(body.id, { password: body.password })
    if (error) return json(400, { error: error.message })
    return json(200, { ok: true })
  }

  if (action === 'update') {
    if (!body.id) return json(400, { error: 'Falta el id del usuario.' })
    const patch: Record<string, unknown> = {}
    if (body.full_name != null) patch.full_name = body.full_name
    if (body.role != null) patch.role_id = body.role
    // Preserva/mezcla meta (name + capabilities).
    const { data: cur } = await admin.from('profiles').select('meta').eq('id', body.id).single()
    const meta = { ...((cur?.meta ?? {}) as Record<string, unknown>) }
    if (body.full_name != null) meta.name = body.full_name
    if (body.capabilities != null) meta.capabilities = body.capabilities
    patch.meta = meta
    const { error } = await admin.from('profiles').update(patch).eq('id', body.id)
    if (error) return json(400, { error: error.message })
    return json(200, { ok: true })
  }

  if (action === 'delete') {
    if (!body.id) return json(400, { error: 'Falta el id del usuario.' })
    const { error } = await admin.auth.admin.deleteUser(body.id)
    if (error) return json(400, { error: error.message })
    return json(200, { ok: true })
  }

  return json(400, { error: 'Acción no reconocida.' })
})

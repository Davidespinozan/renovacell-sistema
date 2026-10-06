// Edge Function: gestión de USUARIOS del equipo (staff) — server-side.
// Crear/editar un usuario y fijar su contraseña requiere el service role (nunca en el
// cliente). Todas las acciones exigen que quien invoca sea ADMIN y esté activo.
// Acciones: create | setPassword | update | suspend | reactivate | delete.
//
// W6-A1 · La AUTORIDAD de suspender/reactivar vive en la base (`suspender_staff` /
// `reactivar_staff`, con el JWT del llamante: ahí se decide quién puede y a quién).
// Esta función solo añade lo que la base no puede hacer: pedirle a Auth que la cuenta
// suspendida no vuelva a obtener tokens (revocación administrativa, best-effort). Un
// access token ya emitido vive hasta expirar (≤ 1 h); desde el instante del comando la
// base ya le niega todo, así que esa pestaña solo verá "cuenta suspendida".
// `delete` ya NO borra la cuenta: es una baja = suspensión marcada. La identidad
// histórica (quién recibió, cobró, surtió, entregó) se conserva.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { observador } from '../_shared/observa.ts'
import { conCors } from '../_shared/cors.ts'   // CC-0B.2 · lista blanca de orígenes (antes '*')

// W6-A3.3 · telemetría opcional (no-op sin SENTRY_DSN; nunca altera la respuesta).
const obs = observador('staff-admin')

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!tieneRol(q.quien, ['admin'])) return json(403, { error: 'Solo Administración puede gestionar usuarios.' })
  const who = { user: { id: q.quien.uid } }

  let body: {
    action?: string; id?: string; email?: string; password?: string
    full_name?: string; role?: string; capabilities?: string[]; motivo?: string
  }
  try { body = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = body.action

  // No permitir que un admin se dé de baja/suspenda/degrade a sí mismo (evita quedarse sin acceso).
  if ((['delete', 'suspend'].includes(action ?? '') || (action === 'update' && body.role && body.role !== 'admin')) && body.id === who.user.id) {
    return json(400, { error: 'No puedes suspender, dar de baja ni cambiar tu propio rol de administrador.' })
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

  // Revocación administrativa (best-effort): la cuenta deja de poder iniciar sesión y de
  // renovar su token. No se promete más: el access token vigente expira solo.
  const revocar = async (id: string): Promise<boolean> => {
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' })
    return !error
  }
  const readmitir = async (id: string): Promise<boolean> => {
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: 'none' })
    return !error
  }

  if (action === 'suspend' || action === 'delete') {
    if (!body.id) return json(400, { error: 'Falta el id del usuario.' })
    const baja = action === 'delete'
    const motivo = (body.motivo ?? '').trim() || (baja ? 'Baja del equipo' : '')
    if (!motivo) return json(400, { error: 'Escribe el motivo de la suspensión.' })
    // La base decide (admin, no a sí mismo, solo personal, motivo, bitácora).
    const { data, error } = await caller.rpc('suspender_staff', { p_uid: body.id, p_motivo: motivo, p_baja: baja })
    if (error) return json(400, { error: error.message })
    const sesionesRevocadas = await revocar(body.id)
    if (!sesionesRevocadas) obs(action, 'internal_error', { code: 'auth_revocation_failed', mensaje: 'Auth no aceptó la revocación de sesiones' })
    return json(200, { ok: true, ...(data as Record<string, unknown>), sesiones_revocadas: sesionesRevocadas })
  }

  if (action === 'reactivate') {
    if (!body.id) return json(400, { error: 'Falta el id del usuario.' })
    const { data, error } = await caller.rpc('reactivar_staff', { p_uid: body.id })
    if (error) return json(400, { error: error.message })
    const readmitido = await readmitir(body.id)
    if (!readmitido) obs(action, 'internal_error', { code: 'auth_readmission_failed', mensaje: 'Auth no aceptó la readmisión' })
    return json(200, { ok: true, ...(data as Record<string, unknown>), readmitido })
  }

  return json(400, { error: 'Acción no reconocida.' })
}))

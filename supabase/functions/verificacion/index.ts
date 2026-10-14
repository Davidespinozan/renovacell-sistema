// Edge Function (se despliega con --no-verify-jwt; valida el JWT ella misma): EVIDENCIA DE VERIFICACIÓN.
//
// Acción `completar` (el propio doctor, con sesión, sin verificar): corrige su cédula y/o sube las fotos del INE.
// Se suben con service_role a proofs/identity/<su perfil>/ y su verificación vuelve a revisión; avisa a Dirección y a
// su vendedor. Nunca da acceso: aprobar sigue siendo de Dirección o de su vendedor.
//
// Acción `evidencia` (con sesión): devuelve enlaces TEMPORALES (10 min) a las fotos del INE de un doctor, solo si
// la base autoriza al llamante a verificarlo (doctor_verificacion_ver con SU JWT: Dirección, su vendedor de cartera
// o el que tiene su conversación). Las políticas del almacenamiento `proofs` (SEC-C3) NO cambian: aquí se firma con
// service_role únicamente lo que la base ya autorizó y solo rutas de ESE doctor (identity/<perfil>/…).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, esSesionDeUsuario } from '../_shared/quien.ts'
import { limitarTodas, respuestaLimite, sujetoUid } from '../_shared/limite.ts'
import { rutasDeEvidencia, validarCompletar } from '../_shared/verificacion.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (p?.action !== 'evidencia' && p?.action !== 'completar') return json(400, { error: 'Acción no reconocida.' })
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!esSesionDeUsuario(authHeader)) return json(401, { error: 'sin_sesion', message: 'Inicia sesión.' })
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  const v = await limitarTodas(admin, [{ scope: 'verificacion_evidencia_uid', sujeto: sujetoUid(q.quien.uid) }])
  if (!v.permitido) return respuestaLimite(v)
  if (p.action === 'completar') {
    if (q.quien.role !== 'doctor') return json(403, { error: 'no_autorizado', message: 'Solo el doctor completa su verificación.' })
    if (q.quien.verified) return json(409, { error: 'ya_verificado', message: 'Tu cuenta ya está verificada.' })
    const d = validarCompletar(p)
    if (!d.ok) return json(400, { error: 'datos_invalidos', message: d.mensaje })
    const uid = q.quien.uid
    const evidencia: Record<string, string> = {}
    for (const [clave, foto] of [['ine-front', d.ineFront], ['ine-back', d.ineBack]] as const) {
      if (!foto) continue
      const ruta = `identity/${uid}/${clave}.${foto.ext}`
      const { error: eSub } = await admin.storage.from('proofs').upload(ruta, foto.bytes, { contentType: foto.tipo, upsert: true })
      if (eSub) return json(503, { error: 'no_disponible', message: 'No se pudo guardar la foto. Intenta de nuevo.' })
      evidencia[clave] = ruta
    }
    const meta = { ...q.quien.meta } as Record<string, unknown>
    const ident = (meta.identity && typeof meta.identity === 'object' ? meta.identity : {}) as Record<string, unknown>
    const ev = (ident.evidence && typeof ident.evidence === 'object' ? ident.evidence : {}) as Record<string, unknown>
    meta.identity = { ...ident, status: 'pending', evidence: { ...ev, ...evidencia } }
    if (d.cedula) meta.cedula = d.cedula
    meta.verification = { status: 'pending', resubmitted_at: new Date().toISOString() }
    const { error: eMeta } = await admin.from('profiles').update({ meta }).eq('id', uid)
    if (eMeta) return json(503, { error: 'no_disponible', message: 'No se pudo guardar. Intenta de nuevo.' })
    const nombre = q.quien.full_name || 'Un doctor'
    const { data: k } = await admin.from('cc_cartera').select('seller_profile_id').eq('profile_id', uid).maybeSingle()
    await admin.from('notifications').insert([
      { body: `${nombre} actualizó sus datos de verificación`, roles: ['admin'], screen: 'av_verif', kind: 'verificacion_actualizada' },
      ...(k?.seller_profile_id ? [{ body: `${nombre} actualizó sus datos de verificación: revísalo en su conversación`, user_ids: [k.seller_profile_id], screen: 'asesorias', kind: 'verificacion_actualizada' }] : []),
    ]).then(() => {}, () => {})
    return json(200, { ok: true, estado: 'pending' })
  }

  const perfil = typeof p.profile_id === 'string' && UUID.test(p.profile_id) ? p.profile_id.toLowerCase() : null
  if (!perfil) return json(400, { error: 'falta_perfil', message: 'Falta el doctor.' })
  const { data, error } = await caller.rpc('doctor_verificacion_ver', { p_profile: perfil })   // autoriza con SU sesión
  if (error || !data) return json(403, { error: 'no_autorizado', message: 'No atiendes a este doctor.' })
  const enlaces: Record<string, string> = {}
  for (const [clave, ruta] of rutasDeEvidencia((data as { evidencia?: unknown }).evidencia, perfil)) {
    const { data: s } = await admin.storage.from('proofs').createSignedUrl(ruta, 600)
    if (s?.signedUrl) enlaces[clave] = s.signedUrl
  }
  return json(200, { evidencia: enlaces })
}))

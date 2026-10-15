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
import { configPush, avisarVerificacion } from '../_shared/push.ts'
import webpush from 'npm:web-push@3.6.7'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// VERIFICACIÓN · aviso a su vendedora (y a su teléfono) sin bloquear la respuesta.
// deno-lint-ignore no-explicit-any
function enSegundoPlano(p: Promise<unknown>) { const er = (globalThis as any).EdgeRuntime; if (er?.waitUntil) er.waitUntil(p.catch(() => {})); else void p.catch(() => {}) }
// deno-lint-ignore no-explicit-any
const avisarAVendedora = (admin: any, perfil: string) => {
  const cfg = configPush((k) => Deno.env.get(k))
  if (cfg) webpush.setVapidDetails(cfg.sujeto, cfg.publica, cfg.privada)
  enSegundoPlano(avisarVerificacion(admin, perfil, cfg, cfg ? (sub, carga) => webpush.sendNotification(sub, carga, { TTL: 86400, urgency: 'high' }) : null))
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (p?.action !== 'evidencia' && p?.action !== 'completar' && p?.action !== 'desde_chat') return json(400, { error: 'Acción no reconocida.' })
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!esSesionDeUsuario(authHeader)) return json(401, { error: 'sin_sesion', message: 'Inicia sesión.' })
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  const v = await limitarTodas(admin, [{ scope: 'verificacion_evidencia_uid', sujeto: sujetoUid(q.quien.uid) }])
  if (!v.permitido) return respuestaLimite(v)
  // FOTOS · "Usar como INE": una foto que el propio doctor mandó por el chat pasa a su evidencia de verificación.
  // La base autoriza (cc_adjunto_para_verificacion con SU sesión); aquí se copia del bucket `chat` a `proofs`.
  if (p.action === 'desde_chat') {
    const clave = p.clave === 'ine-front' || p.clave === 'ine-back' ? p.clave as 'ine-front' | 'ine-back' : null
    const adjunto = typeof p.adjunto_id === 'string' && UUID.test(p.adjunto_id) ? p.adjunto_id : null
    if (!clave || !adjunto) return json(400, { error: 'datos_invalidos', message: 'Indica la foto y si es el frente o el reverso.' })
    const { data: a, error: eA } = await caller.rpc('cc_adjunto_para_verificacion', { p_adjunto: adjunto })
    if (eA || !a) return json(403, { error: 'no_autorizado', message: /NO_ES_DEL_DOCTOR/.test(eA?.message ?? '') ? 'Solo una foto que mandó el propio doctor sirve como su identificación.' : 'No atiendes a este doctor.' })
    const info = a as { profile_id: string; ruta: string; tipo: string }
    const { data: blob, error: eD } = await admin.storage.from('chat').download(info.ruta)
    if (eD || !blob) return json(503, { error: 'no_disponible', message: 'No se pudo leer la foto.' })
    const ruta = `identity/${info.profile_id}/${clave}.${info.tipo === 'image/png' ? 'png' : 'jpg'}`
    const { error: eS } = await admin.storage.from('proofs').upload(ruta, new Uint8Array(await blob.arrayBuffer()), { contentType: info.tipo, upsert: true })
    if (eS) return json(503, { error: 'no_disponible', message: 'No se pudo guardar la foto como evidencia.' })
    const { data: prof } = await admin.from('profiles').select('meta').eq('id', info.profile_id).maybeSingle()
    const meta = { ...((prof?.meta ?? {}) as Record<string, unknown>) }
    const ident = (meta.identity && typeof meta.identity === 'object' ? meta.identity : {}) as Record<string, unknown>
    const ev = (ident.evidence && typeof ident.evidence === 'object' ? ident.evidence : {}) as Record<string, unknown>
    meta.identity = { ...ident, evidence: { ...ev, [clave]: ruta } }
    const { error: eM } = await admin.from('profiles').update({ meta }).eq('id', info.profile_id)
    if (eM) return json(503, { error: 'no_disponible', message: 'No se pudo guardar.' })
    await admin.rpc('cc_adjunto_marcar_uso', { p_adjunto: adjunto, p_uso: clave, p_por: q.quien.uid }).then(() => {}, () => {})
    return json(200, { ok: true, clave })
  }

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
    // Aviso a su vendedora (y a su teléfono) para que lo revise; sin vendedora, a Dirección.
    avisarAVendedora(admin, uid)
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

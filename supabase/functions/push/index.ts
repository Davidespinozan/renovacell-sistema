// Edge Function (se despliega con --no-verify-jwt; valida el JWT ella misma): AVISOS PUSH DEL CHAT.
//   clave      — la llave pública para que el navegador se suscriba (null si los avisos no están configurados).
//   suscribir  — guarda la dirección de avisos de ESTE dispositivo, de la cuenta (JWT) o del visitante (token).
//   baja       — este dispositivo deja de recibir avisos.
//   promo      — PROMO-8 · Dirección/Facturación: avisa (push) a los doctores que recibieron una promoción por el chat y
//                tienen avisos activados; una sola vez por doctor (promocion_avisos_pendientes / _marcar).
//   equipo     — PUSH DEL EQUIPO (20270220) · lo llama el trigger de la base (x-cron-secret) al guardar un mensaje del chat
//                del equipo o un aviso; la base dice a quién y qué (equipo_push_carga), aquí solo se manda.
// El envío de avisos del chat lo hace la función `chat` cuando alguien escribe; aquí se administra el dispositivo y la promo.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, esSesionDeUsuario, tieneRol } from '../_shared/quien.ts'
import { limitarTodas, respuestaLimite, sujetoPublico, sujetoUid } from '../_shared/limite.ts'
import { hashToken } from '../_shared/visitante.ts'
import { configPush, enviarAvisos } from '../_shared/push.ts'
import webpush from 'npm:web-push@3.6.7'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Comparación de tiempo constante (por hash) para el secreto de la tarea programada (igual que comm-dispatch).
async function iguales(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false
  const h = async (t: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))
  const [x, y] = await Promise.all([h(a), h(b)])
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const cfg = configPush((k) => Deno.env.get(k))
  if (p?.action === 'clave') return json(200, { clave: cfg?.publica ?? null })
  if (p?.action === 'equipo') {
    const secreto = (Deno.env.get('CORREOS_CRON_SECRET') ?? '').trim()
    if (secreto.length < 32 || !(await iguales(req.headers.get('x-cron-secret') ?? '', secreto))) return json(401, { error: 'no_autorizado' })
    const tipo = p.tipo === 'mensaje' || p.tipo === 'aviso' ? p.tipo : null
    const id = typeof p.id === 'string' && /^[0-9a-f-]{36}$/.test(p.id) ? p.id : null
    if (!tipo || !id) return json(400, { error: 'datos_invalidos' })
    if (!cfg) return json(200, { enviados: 0, configurado: false })
    const { data: carga } = await admin.rpc('equipo_push_carga', { p_tipo: tipo, p_id: id })
    const c = carga as { perfiles?: string[]; title: string; body: string; url: string; tag: string } | null
    if (!c?.perfiles?.length) return json(200, { enviados: 0 })
    const { data: destinos } = await admin.rpc('push_destinos', { p_profiles: c.perfiles, p_visitors: [] })
    const lista = (destinos ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>
    if (!lista.length) return json(200, { enviados: 0 })
    webpush.setVapidDetails(cfg.sujeto, cfg.publica, cfg.privada)
    const enviados = await enviarAvisos(admin, (sub, carga) => webpush.sendNotification(sub, carga, { TTL: tipo === 'mensaje' ? 3600 : 86_400, urgency: 'high' }), lista,
      { title: c.title, body: c.body, url: c.url, tag: c.tag })
    return json(200, { enviados })
  }
  if (p?.action === 'promo') {
    // PROMO-8 · solo Dirección o Facturación con su sesión; el servidor decide a quién (pendientes) y marca a quién avisó.
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!esSesionDeUsuario(authHeader)) return json(401, { error: 'sin_identidad', message: 'Inicia sesión.' })
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const q = await resolverQuien(caller, admin)
    if (!q.ok) return json(q.status, q.body)
    if (!tieneRol(q.quien, ['admin', 'billing'])) return json(403, { error: 'no_autorizado', message: 'Solo Dirección o Facturación avisan promociones.' })
    const promo = typeof p.promocion_id === 'string' && /^[0-9a-f-]{36}$/.test(p.promocion_id) ? p.promocion_id : null
    if (!promo) return json(400, { error: 'promocion_invalida', message: 'Falta promocion_id.' })
    const { data: pend, error } = await admin.rpc('promocion_avisos_pendientes', { p_id: promo })
    if (error || !pend) return json(404, { error: 'promocion_inexistente', message: 'Esa promoción no existe.' })
    const perfiles: string[] = Array.isArray(pend.perfiles) ? pend.perfiles : []
    if (!pend.vigente) return json(409, { error: 'promo_no_vigente', message: 'La promoción ya no está vigente: no se avisa.' })
    if (!perfiles.length) return json(200, { pendientes: 0, con_avisos: 0, enviados: 0, configurado: !!cfg })
    if (!cfg) return json(200, { pendientes: perfiles.length, con_avisos: 0, enviados: 0, configurado: false })
    const { data: destinos } = await admin.rpc('push_destinos', { p_profiles: perfiles, p_visitors: [] })
    const lista = (destinos ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>
    let enviados = 0
    if (lista.length) {
      webpush.setVapidDetails(cfg.sujeto, cfg.publica, cfg.privada)
      enviados = await enviarAvisos(admin, (sub, carga) => webpush.sendNotification(sub, carga, { TTL: 86_400, urgency: 'normal' }), lista,
        { title: `Promoción · ${String(pend.nombre ?? 'Renovacell')}`, body: `Precios especiales ${String(pend.vigencia ?? '')}. Ábrela en tu chat de Renovacell.`, url: 'https://sistema.renovacell.mx/sistema', tag: `rc-promo-${promo}` })
    }
    // Se marca a TODOS los pendientes: el aviso es una sola vez; quien no tiene avisos activados ya tiene el mensaje en su chat.
    await admin.rpc('promocion_avisos_marcar', { p_id: promo, p_profiles: perfiles }).then(() => {}, () => {})
    return json(200, { pendientes: perfiles.length, con_avisos: new Set(lista.map((d) => d.id)).size ? lista.length : 0, enviados, configurado: true })
  }
  if (p?.action !== 'suscribir' && p?.action !== 'baja') return json(400, { error: 'Acción no reconocida.' })
  const sub = p.suscripcion as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined
  const endpoint = typeof sub?.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length <= 1000 ? sub.endpoint : null
  if (!endpoint) return json(400, { error: 'suscripcion_invalida', message: 'Este navegador no entregó una dirección de avisos válida.' })
  if (p.action === 'baja') { await admin.rpc('push_baja', { p_endpoint: endpoint }).then(() => {}, () => {}); return json(200, { ok: true }) }
  if (!cfg) return json(503, { error: 'no_configurado', message: 'Los avisos aún no están activados en Renovacell.' })
  const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : ''; const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : ''
  const authHeader = req.headers.get('Authorization') ?? ''
  let perfil: string | null = null; let hash: string | null = null
  if (esSesionDeUsuario(authHeader)) {
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const q = await resolverQuien(caller, admin)
    if (!q.ok) return json(q.status, q.body)
    perfil = q.quien.uid
  } else {
    hash = await hashToken(p.token)
    if (!hash) return json(401, { error: 'sin_identidad', message: 'Abre la conversación de nuevo.' })
  }
  const v = await limitarTodas(admin, [{ scope: 'push_suscribir', sujeto: perfil ? sujetoUid(perfil) : await sujetoPublico(req) }])
  if (!v.permitido) return respuestaLimite(v)
  const { error } = await admin.rpc('push_suscribir', { p_profile: perfil, p_visitor_hash: hash, p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth })
  if (error) return json(/SESION_INVALIDA/.test(error.message) ? 401 : 400, { error: 'no_guardado', message: 'No se pudieron activar los avisos en este dispositivo.' })
  return json(200, { ok: true })
}))

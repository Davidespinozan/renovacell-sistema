// Edge Function (se despliega con --no-verify-jwt; valida el JWT ella misma): AVISOS PUSH DEL CHAT.
//   clave      — la llave pública para que el navegador se suscriba (null si los avisos no están configurados).
//   suscribir  — guarda la dirección de avisos de ESTE dispositivo, de la cuenta (JWT) o del visitante (token).
//   baja       — este dispositivo deja de recibir avisos.
// El envío lo hace la función `chat` cuando alguien escribe; aquí solo se administra el dispositivo.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, esSesionDeUsuario } from '../_shared/quien.ts'
import { limitarTodas, respuestaLimite, sujetoPublico, sujetoUid } from '../_shared/limite.ts'
import { hashToken } from '../_shared/visitante.ts'
import { configPush } from '../_shared/push.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const cfg = configPush((k) => Deno.env.get(k))
  if (p?.action === 'clave') return json(200, { clave: cfg?.publica ?? null })
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

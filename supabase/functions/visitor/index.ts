// Edge Function PÚBLICA (desplegar con --no-verify-jwt): identidad de VISITANTE (CC-1).
//
// Acciones:
//   abrir   — sin sesión. Con un token válido reanuda al visitante (last_seen, atribución
//             según política); sin token válido crea uno nuevo y devuelve el token (única
//             vez que el token viaja al cliente). Nunca revela si un token existía.
//   adoptar — con sesión (JWT). La cuenta autenticada se apropia del visitante cuyo token
//             posee, o de los visitantes que su propio registro dejó vinculados. El perfil
//             se deriva del JWT; el cliente NO manda profile_id ni visitor_id.
//
// La autoridad está en la base (cc_visitante_*, solo service_role). Esta función solo
// hashea el token, acota la entrada y aplica el limitador CC-0B (IP + global; uid para
// adoptar). El token crudo no se persiste ni se registra.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien } from '../_shared/quien.ts'
import { conCors } from '../_shared/cors.ts'
import { limitarTodas, respuestaLimite, sujetoPublico, sujetoUid } from '../_shared/limite.ts'
import { generarToken, hashToken, limpiarAtribucion, limpiarRef, mapearErrorAdopcion } from '../_shared/visitante.ts'

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
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let p: { action?: unknown; token?: unknown; atribucion?: unknown; ref?: unknown }
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = p.action === 'abrir' || p.action === 'adoptar' ? p.action : null
  if (!action) return json(400, { error: 'Acción no reconocida.' })

  // El hash del token que trae el cliente (null si no trae uno con forma válida).
  const hash = await hashToken(p.token)

  if (action === 'abrir') {
    const sujeto = await sujetoPublico(req)
    const v = await limitarTodas(admin, [{ scope: 'visitor_abrir', sujeto }, { scope: 'visitor_abrir_global', sujeto: 'global' }])
    if (!v.permitido) return respuestaLimite(v)
    const nuevoToken = generarToken()
    const nuevoHash = await hashToken(nuevoToken)
    const { data, error } = await admin.rpc('cc_visitante_abrir', {
      p_hash: hash, p_hash_nuevo: nuevoHash, p_attr: limpiarAtribucion(p.atribucion), p_ref: limpiarRef(p.ref),
    })
    if (error || !data) return json(503, { error: 'no_disponible', message: 'No se pudo abrir la sesión de visitante.' })
    const r = data as { visitor_id: string; nuevo: boolean; estado: string }
    // El token SOLO viaja cuando se acaba de crear; un token válido reanuda sin reemitirse.
    return json(200, r.nuevo ? { visitor_id: r.visitor_id, nuevo: true, token: nuevoToken } : { visitor_id: r.visitor_id, nuevo: false })
  }

  // adoptar: sesión obligatoria; el perfil es el del JWT.
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  const v = await limitarTodas(admin, [{ scope: 'visitor_adoptar', sujeto: sujetoUid(q.quien.uid) }])
  if (!v.permitido) return respuestaLimite(v)
  const { data, error } = await admin.rpc('cc_visitante_adoptar', { p_hash: hash, p_profile: q.quien.uid })
  if (error) { const e = mapearErrorAdopcion(error.message); return json(e.status, e.body) }
  // El conflicto se DEVUELVE desde la base (así queda en bitácora) y aquí se traduce a 409.
  if ((data as { estado?: string } | null)?.estado === 'ajeno') { const e = mapearErrorAdopcion('VISITANTE_AJENO'); return json(e.status, e.body) }
  return json(200, data)
}))

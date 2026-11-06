// Edge Function: ASISTENTE DEL EQUIPO (6 nov 2026). El personal pregunta sobre el sistema y sus datos; v1 SOLO CONSULTA.
// Las herramientas corren con el JWT de quien pregunta (cada rol ve lo que ya le permite la base); la bitácora la escribe
// el servidor (ia_eq_consultas). Sin ANTHROPIC_API_KEY responde 501. Límites: 40 preguntas/hora por persona y techo diario
// de tokens. Modelo: ASISTENTE_EQUIPO_MODEL (por defecto claude-opus-5-5, esfuerzo bajo).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, esSesionDeUsuario } from '../_shared/quien.ts'
import { limitarTodas, limitar } from '../_shared/limite.ts'
import { crearProveedorAnthropic } from '../_shared/ia/proveedor.ts'
import { ejecutarAsistente, historialValido, MAX_PREGUNTA } from '../_shared/ia/asistenteEquipo.ts'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ROLES = new Set(['admin', 'pos', 'warehouse', 'packing', 'driver'])

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const key = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  if (!key) return json(501, { error: 'no_configurado', message: 'El asistente no está configurado.' })
  const url = Deno.env.get('SUPABASE_URL')!; const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!esSesionDeUsuario(authHeader)) return json(401, { error: 'sin_sesion', message: 'Inicia sesión.' })
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!ROLES.has(q.quien.role)) return json(403, { error: 'solo_equipo', message: 'El asistente es solo para el equipo.' })

  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const pregunta = typeof p?.pregunta === 'string' ? p.pregunta.trim() : ''
  if (!pregunta) return json(400, { error: 'sin_pregunta', message: 'Escribe tu pregunta.' })
  if (pregunta.length > MAX_PREGUNTA) return json(400, { error: 'pregunta_larga', message: `Máximo ${MAX_PREGUNTA} caracteres.` })

  const sujeto = 'uid:' + q.quien.uid
  const v = await limitarTodas(admin, [{ scope: 'ia_equipo_hora', sujeto }, { scope: 'ia_equipo_tokens_dia', sujeto: 'global', costo: 8000 }])
  if (!v.permitido) return json(429, { error: 'limite', message: 'Hiciste muchas preguntas seguidas. Espera un rato e intenta de nuevo.' })

  const model = (Deno.env.get('ASISTENTE_EQUIPO_MODEL') ?? 'claude-opus-5-5').trim() || 'claude-opus-5-5'
  const proveedor = crearProveedorAnthropic({ key, model, fetch: globalThis.fetch.bind(globalThis), opciones: { effort: 'low' } })
  const nombre = (q.quien.meta?.name as string | undefined) ?? q.quien.full_name ?? ''
  const r = await ejecutarAsistente(
    { pregunta, historial: historialValido(p?.historial), quien: { nombre, rol: q.quien.role }, pantalla: typeof p?.pantalla === 'string' ? p.pantalla : null, ahora: new Date() },
    { proveedor, rpc: (fn, args) => caller.rpc(fn, args) },
  )
  const usados = r.usage.input + r.usage.output
  if (usados > 8000) await limitar(admin, 'ia_equipo_tokens_dia', 'global', { costo: usados - 8000 }).catch(() => {})
  await admin.from('ia_eq_consultas').insert({ profile_id: q.quien.uid, rol: q.quien.role, pregunta, respuesta: r.texto, herramientas: r.herramientas, modelo: model,
    input_tokens: r.usage.input, output_tokens: r.usage.output, error: r.error ?? null }).then(() => {}, () => {})
  return json(200, { ok: r.ok, respuesta: r.texto })
}))

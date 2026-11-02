// Edge Function: EXAMEN DE LA IA (IA mejor que el humano · A, 2 nov 2026). La llama el CRON del examen (secreto del cron:
// responde 202 y trabaja en segundo plano, así cerrar la pantalla no detiene nada) o Dirección con su sesión. Corre UN caso:
// el orquestador real del portal (mismo prompt, herramientas, validación y datos del negocio que recibe el doctor) con el
// modelo de la corrida, lecturas reales y escrituras simuladas (_shared/ia/examen.ts), y después el juez. Registra el
// resultado con ia_examen_registrar. La pantalla "Asesora IA" la llama caso por caso.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { enSegundoPlano } from '../_shared/avisoChat.ts'
import { conCors } from '../_shared/cors.ts'
import { ejecutarTurno } from '../_shared/ia/orquestador.ts'
import { configurar, crearProveedorAnthropic, esModeloConPensamiento } from '../_shared/ia/proveedor.ts'
import { configPortal, dependenciasPortal, leerNegocio } from '../_shared/ia/responder.ts'
import { REGLAS_IA } from '../_shared/conocimiento.ts'
import { costoUsd, mensajeJuez, mensajesDelCaso, parsearJuicio, rpcExamen, SISTEMA_JUEZ, type Caso } from '../_shared/ia/examen.ts'

const MODELO_JUEZ = 'claude-opus-5-5'
const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const secreto = (Deno.env.get('CORREOS_CRON_SECRET') ?? '').trim()
  const delCron = secreto.length >= 32 && await iguales(req.headers.get('x-cron-secret') ?? '', secreto)
  if (!delCron) {
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const q = await resolverQuien(caller, admin)
    if (!q.ok) return json(q.status, q.body)
    if (!tieneRol(q.quien, ['admin'])) return json(403, { error: 'Solo Dirección corre el examen.' })
  }

  const body = await req.json().catch(() => ({})) as { corrida_id?: string; caso_id?: string }
  if (!UUID.test(body.corrida_id ?? '') || !/^[A-Z]{1,3}[0-9]{2,3}$/.test(body.caso_id ?? '')) return json(400, { error: 'corrida_id y caso_id requeridos' })
  if (delCron) { enSegundoPlano(correrCaso(admin, body.corrida_id!, body.caso_id!)); return json(202, { encolado: true }) }
  const r = await correrCaso(admin, body.corrida_id!, body.caso_id!)
  return json(r.status, r.body)
}))

// deno-lint-ignore no-explicit-any
async function correrCaso(admin: any, corridaId: string, casoId: string): Promise<{ status: number; body: unknown }> {
  const { data: dc, error: ec } = await admin.rpc('ia_examen_caso', { p_corrida: corridaId, p_caso: casoId })
  if (ec || !dc) return { status: 404, body: { error: 'Caso no encontrado en la corrida.' } }
  const corrida = dc as { modelo: string; esfuerzo: 'low' | 'medium' | 'high'; perfil_id: string; caso: Caso }

  const env = (k: string) => Deno.env.get(k)
  const cfg0 = configurar(env)
  if (!cfg0.ok) return { status: 503, body: { error: 'IA no configurada.' } }
  const config = configPortal(cfg0.config, corrida.modelo, env)
  const proveedor = crearProveedorAnthropic({ key: cfg0.key, model: corrida.modelo, fetch: globalThis.fetch.bind(globalThis),
    opciones: esModeloConPensamiento(corrida.modelo) ? { effort: corrida.esfuerzo, fallbacks: true } : undefined })
  const deps = dependenciasPortal(await leerNegocio(admin))
  const ex = rpcExamen((fn, args) => admin.rpc(fn, args), corrida.perfil_id)
  const mensajes = mensajesDelCaso(corrida.caso)

  const t0 = Date.now()
  const r = await ejecutarTurno(
    { conv: '00000000-0000-4000-8000-00000000e4a1', triggerSeq: mensajes.length, actor: 'doctor', profile: corrida.perfil_id, visitorHash: null, textoUsuario: corrida.caso.pregunta, canal: 'portal' },
    { rpc: ex.rpc, leerMensajes: async () => mensajes, proveedor, config, politica: deps.politica, herramientas: deps.herramientas, validacion: deps.validacion, reglasConocimiento: REGLAS_IA },
  )
  const latencia = Date.now() - t0
  const respuesta = ex.capturado.respuesta ?? ''

  // Juez: Opus 5.5 con esfuerzo medio, sin herramientas; ve la respuesta y las salidas reales de las herramientas.
  const juez = crearProveedorAnthropic({ key: cfg0.key, model: MODELO_JUEZ, fetch: globalThis.fetch.bind(globalThis), opciones: { effort: 'medium', fallbacks: true } })
  const j = respuesta ? await juez.generar({ system: SISTEMA_JUEZ, messages: [{ role: 'user', content: mensajeJuez(corrida.caso, respuesta, ex.traza) }], tools: [], max_tokens: 6000, timeoutMs: 60_000 }) : null
  const juicio = j && j.tipo === 'texto' ? parsearJuicio(j.texto) : null

  const resultado = {
    respuesta, estado: r.estado, motivo_validacion: ex.capturado.motivo ?? r.motivoValidacion ?? null,
    herramientas: ex.traza.map((t) => ({ herramienta: t.herramienta, args: t.args })), evidencia: r.evidencia ?? [],
    latencia_ms: latencia, tokens_in: r.usage.input, tokens_out: r.usage.output, costo_usd: costoUsd(corrida.modelo, r.usage),
    puntaje: juicio?.puntaje ?? (respuesta ? null : 0), aprobado: juicio?.aprobado ?? false, juicio,
    error: ex.capturado.falla ?? (juicio || !respuesta ? null : 'juez_sin_veredicto'),
  }
  // Un fallo del proveedor (sin respuesta) no se registra: el caso sigue en la cola y el cron lo reintenta.
  if (!respuesta && ex.capturado.falla) return { status: 502, body: { error: 'El modelo no respondió; se reintenta.' } }
  const { error: er } = await admin.rpc('ia_examen_registrar', { p_corrida: corridaId, p_caso: casoId, p_r: resultado })
  if (er) return { status: 500, body: { error: 'No se pudo registrar el resultado.' } }
  return { status: 200, body: { caso_id: casoId, ...resultado } }
}

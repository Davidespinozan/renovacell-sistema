// Edge Function PÚBLICA (desplegar con --no-verify-jwt): CONVERSACIÓN CANÓNICA (CC-2).
//
// Una sola puerta para visitante (token de CC-1) y para cuentas (JWT). El actor lo deriva el
// servidor: perfil+rol del JWT, o visitante por hash del token. Nunca se acepta actor_type,
// actor_id, profile_id ni seller_profile_id del cliente. La autoridad está en los comandos
// cc_* (solo service_role); aquí se acota la entrada, se aplica el limitador (CC-0B) y se
// traduce la respuesta. El contenido de los mensajes no se registra en ningún lado.
//
// IA (CC-4): tras un mensaje del dueño en un modo donde la IA puede hablar, el ORQUESTADOR
// (_shared/ia/*) reclama el turno en la base, deriva audiencia y permisos del perfil, consulta
// conocimiento/precio/stock/pedidos solo por herramientas server-side, valida la salida y la
// persiste por cc_enviar_mensaje(actor=ai) re-verificando el modo bajo lock (takeover humano →
// descarte). Reintentos no duplican (un turno por disparador). Sin IA disponible, un aviso de
// sistema una sola vez. El límite y el costo diario en tokens los aplica CC-0B aquí.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien } from '../_shared/quien.ts'
import { conCors } from '../_shared/cors.ts'
import { limitarTodas, respuestaLimite, sujetoPublico, sujetoUid } from '../_shared/limite.ts'
import { hashToken } from '../_shared/visitante.ts'
import { derivarActor, validarContenido, validarClientId, mapearErrorChat, IA_PUEDE } from '../_shared/chat.ts'
// CC-4 · el adaptador mínimo de CC-2 se sustituye por el orquestador (módulos puros inyectados).
import { ejecutarTurno } from '../_shared/ia/orquestador.ts'
import * as politica from '../_shared/ia/politica.ts'
import * as herramientas from '../_shared/ia/herramientas.ts'
import * as validacion from '../_shared/ia/validacion.ts'
import { configurar, crearProveedorAnthropic } from '../_shared/ia/proveedor.ts'
import { REGLAS_IA } from '../_shared/conocimiento.ts'
import { limitar, tokensEstimados } from '../_shared/limite.ts'

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const ACCIONES = new Set(['abrir', 'leer', 'enviar', 'leido', 'solicitar_asesor', 'rechazar_asesor', 'asignar', 'iniciar', 'terminar', 'reanudar_ia', 'cerrar', 'reabrir', 'cola'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = typeof p.action === 'string' && ACCIONES.has(p.action) ? p.action as string : null
  if (!action) return json(400, { error: 'Acción no reconocida.' })

  // Identidad: JWT (si viene) manda; si no, visitante por token.
  const authHeader = req.headers.get('Authorization') ?? ''
  let quien: { uid: string; role: string } | null = null
  if (authHeader.replace(/^Bearer\s+/i, '').trim() && authHeader.replace(/^Bearer\s+/i, '').trim() !== anon) {
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const q = await resolverQuien(caller, admin)
    if (!q.ok) return json(q.status, q.body)
    quien = { uid: q.quien.uid, role: q.quien.role }
  }
  const hash = quien ? null : await hashToken(p.token)
  const actor = derivarActor(quien, hash)
  if (!actor) return json(401, { error: 'sin_identidad', message: 'Inicia sesión o abre la conversación desde el sitio.' })
  const sujeto = quien ? sujetoUid(quien.uid) : await sujetoPublico(req)
  const conv = typeof p.conversation_id === 'string' && UUID.test(p.conversation_id) ? p.conversation_id : null
  const falla = (e: { message?: string } | null) => { const m = mapearErrorChat(e?.message); return json(m.status, m.body) }

  // ── cola (asesores/Dirección) ───────────────────────────────────────────
  if (action === 'cola') {
    if (!quien) return json(401, { error: 'sin_identidad' })
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data, error } = await caller.rpc('cc_cola_asesorias')
    if (error) return falla(error)
    return json(200, { cola: data ?? [] })
  }

  // ── abrir / reanudar ────────────────────────────────────────────────────
  if (action === 'abrir') {
    const v = await limitarTodas(admin, quien
      ? [{ scope: 'chat_abrir_uid', sujeto }]
      : [{ scope: 'chat_abrir', sujeto }, { scope: 'chat_abrir_global', sujeto: 'global' }])
    if (!v.permitido) return respuestaLimite(v)
    const { data, error } = await admin.rpc('cc_abrir_conversacion', { p_visitor_hash: hash, p_profile: actor.profile })
    if (error) return falla(error)
    return json(200, data)
  }

  if (!conv) return json(400, { error: 'falta_conversacion', message: 'Falta conversation_id.' })
  const base = { p_conv: conv, p_actor_type: actor.actor, p_visitor_hash: hash, p_profile: actor.profile }

  if (action === 'leer') {
    const desde = Number.isFinite(Number(p.desde_seq)) ? Math.max(0, Math.floor(Number(p.desde_seq))) : 0
    const { data, error } = await admin.rpc('cc_leer_conversacion', { ...base, p_desde_seq: desde, p_limite: 100 })
    if (error) return falla(error)
    // CC-5 · id del carrito activo del dueño (la autoridad para VERLO la decide cc_carrito_ver por actor).
    let cart_id: string | null = null
    try {
      const { data: c } = await admin.from('cc_conversations').select('visitor_id, profile_id').eq('id', conv).maybeSingle()
      if (c) {
        const q = c.profile_id ? admin.from('cc_carts').select('id').eq('profile_id', c.profile_id).eq('estado', 'active') : admin.from('cc_carts').select('id').eq('visitor_id', c.visitor_id).is('profile_id', null).eq('estado', 'active')
        const { data: k } = await q.maybeSingle(); cart_id = (k as { id?: string } | null)?.id ?? null
      }
    } catch { cart_id = null }
    return json(200, { ...(data as Record<string, unknown>), cart_id })
  }
  if (action === 'leido') {
    const seq = Number.isFinite(Number(p.seq)) ? Math.max(0, Math.floor(Number(p.seq))) : 0
    const { error } = await admin.rpc('cc_marcar_leido', { ...base, p_seq: seq })
    if (error) return falla(error)
    return json(200, { ok: true })
  }
  if (action === 'enviar') {
    const v = await limitarTodas(admin, quien
      ? [{ scope: 'chat_enviar_uid', sujeto }, { scope: 'chat_enviar_global', sujeto: 'global' }]
      : [{ scope: 'chat_enviar', sujeto }, { scope: 'chat_enviar_global', sujeto: 'global' }])
    if (!v.permitido) return respuestaLimite(v)
    const c = validarContenido(p.content)
    if (!c.ok) return json(400, { error: c.error, message: 'El mensaje no es válido.' })
    const clientId = validarClientId(p.client_message_id)
    const { data, error } = await admin.rpc('cc_enviar_mensaje', { ...base, p_client_id: clientId, p_content: c.texto })
    if (error) return falla(error)
    const r = data as { id: string; seq: number; idempotente: boolean; modo: string }
    // Adaptador de IA (solo tras un mensaje del dueño, no idempotente, en modo con IA).
    let ia: 'respondio' | 'no_disponible' | 'silenciada' | 'omitida' | 'descartada' | 'en_curso' | 'limitada' = 'omitida'
    if (!r.idempotente && (actor.actor === 'visitor' || actor.actor === 'doctor')) {
      ia = IA_PUEDE(r.modo) ? await responderIA(admin, conv, r.seq, actor.actor, actor.profile, hash, c.texto, sujeto) : 'silenciada'
    }
    return json(200, { ...r, ia })
  }
  if (action === 'solicitar_asesor') {
    const v = await limitarTodas(admin, [{ scope: 'chat_solicitar', sujeto }])
    if (!v.permitido) return respuestaLimite(v)
    const { data, error } = await admin.rpc('cc_solicitar_asesor', base)
    if (error) return falla(error)
    return json(200, data)
  }
  // CC-7 · el dueño rechaza al asesor para la compra actual (la IA sigue; la cartera no cambia).
  if (action === 'rechazar_asesor') {
    const v = await limitarTodas(admin, [{ scope: 'chat_solicitar', sujeto }])
    if (!v.permitido) return respuestaLimite(v)
    const { data, error } = await admin.rpc('cc_handoff_rechazar', base)
    if (error) return falla(error)
    return json(200, data)
  }
  if (action === 'asignar') {
    if (!quien) return json(401, { error: 'sin_identidad' })
    const seller = p.seller === null ? null : (typeof p.seller === 'string' && UUID.test(p.seller) ? p.seller : quien.uid) // CC-7 · solo Dirección asigna/libera (la base lo exige); el vendedor solo confirma lo suyo
    const { data, error } = await admin.rpc('cc_asignar_asesor', { p_conv: conv, p_actor_profile: quien.uid, p_seller: seller })
    if (error) return falla(error)
    return json(200, data)
  }
  if (action === 'iniciar') {
    if (!quien) return json(401, { error: 'sin_identidad' })
    const { data, error } = await admin.rpc('cc_iniciar_asesoria', { p_conv: conv, p_profile: quien.uid })
    if (error) return falla(error)
    return json(200, data)
  }
  if (action === 'terminar') {
    if (!quien) return json(401, { error: 'sin_identidad' })
    const { data, error } = await admin.rpc('cc_terminar_asesoria', { p_conv: conv, p_profile: quien.uid })
    if (error) return falla(error)
    return json(200, data)
  }
  if (action === 'reanudar_ia') {
    const { data, error } = await admin.rpc('cc_reanudar_ia', base)
    if (error) return falla(error)
    return json(200, data)
  }
  if (action === 'cerrar') {
    const { data, error } = await admin.rpc('cc_cerrar_conversacion', base)
    if (error) return falla(error)
    return json(200, data)
  }
  if (action === 'reabrir') {
    const { data, error } = await admin.rpc('cc_reabrir_conversacion', base)
    if (error) return falla(error)
    return json(200, data)
  }
  return json(400, { error: 'Acción no reconocida.' })
}))

// CC-4 · Orquestador comercial de IA. Aquí solo se arma el entorno (proveedor, límites, lectura
// interna de mensajes) y se traduce el resultado; la lógica vive en _shared/ia/* (pura, probada).
// deno-lint-ignore no-explicit-any
async function responderIA(admin: any, conv: string, seqUsuario: number, actor: 'visitor' | 'doctor', profile: string | null, visitorHash: string | null, texto: string, sujeto: string): Promise<'respondio' | 'no_disponible' | 'silenciada' | 'descartada' | 'en_curso' | 'limitada'> {
  const env = (k: string) => Deno.env.get(k)
  const cfg = configurar(env)
  const aviso = async () => { await admin.rpc('cc_ia_aviso_no_disponible', { p_conv: conv }).then(() => {}, () => {}) }
  if (!cfg.ok) { await aviso(); return 'no_disponible' }
  // CC-0B · ráfaga/hora por sujeto y techo global: sin cupo NO se llama al proveedor.
  const v = await limitarTodas(admin, actor === 'doctor'
    ? [{ scope: 'ia_turno_uid', sujeto }, { scope: 'ia_turno_hora', sujeto }, { scope: 'ia_turno_global', sujeto: 'global' }]
    : [{ scope: 'ia_turno', sujeto }, { scope: 'ia_turno_hora', sujeto }, { scope: 'ia_turno_global', sujeto: 'global' }])
  if (!v.permitido) return 'limitada'
  // Costo diario en tokens: pre-carga estimada (historial acotado + salida) y ajuste con el consumo real.
  const estimado = tokensEstimados([texto], cfg.config.maxTokens) + 1500
  const costo = await limitarTodas(admin, [{ scope: 'ia_tokens_dia', sujeto: 'global', costo: estimado }, ...(actor === 'doctor' ? [{ scope: 'ia_tokens_dia_uid', sujeto, costo: estimado }] : [])])
  if (!costo.permitido) return 'limitada'

  const proveedor = crearProveedorAnthropic({ key: cfg.key, model: cfg.config.model, fetch: globalThis.fetch.bind(globalThis) })
  const resultado = await ejecutarTurno(
    { conv, triggerSeq: seqUsuario, actor, profile: actor === 'doctor' ? profile : null, visitorHash, textoUsuario: texto },
    {
      rpc: (fn, args) => admin.rpc(fn, args),
      leerMensajes: (c, hasta, limite) => leerInterno(admin, c, hasta, limite),
      proveedor, config: cfg.config, politica, herramientas, validacion, reglasConocimiento: REGLAS_IA,
    },
  )
  const usados = resultado.usage.input + resultado.usage.output
  if (usados > 0 && usados !== estimado) {
    await limitar(admin, 'ia_tokens_dia', 'global', { costo: usados - estimado })
    if (actor === 'doctor') await limitar(admin, 'ia_tokens_dia_uid', sujeto, { costo: usados - estimado })
  }
  switch (resultado.estado) {
    case 'respondio': case 'ya_respondido': return 'respondio'
    case 'descartada': return 'descartada'
    case 'en_curso': return 'en_curso'
    case 'silenciada': return 'silenciada'
    default: return 'no_disponible'   // fallo del proveedor o de persistencia (el orquestador ya dejó el aviso de sistema)
  }
}

// Lectura interna con service_role (el orquestador corre en el servidor, no es un cliente).
// deno-lint-ignore no-explicit-any
async function leerInterno(admin: any, conv: string, hastaSeq: number, limite: number): Promise<Array<{ actor: string; content: string }>> {
  const { data } = await admin.from('cc_messages').select('actor_type, content, seq').eq('conversation_id', conv).lte('seq', hastaSeq).order('seq', { ascending: false }).limit(limite)
  return ((data ?? []) as Array<{ actor_type: string; content: string }>).reverse().map((m) => ({ actor: m.actor_type, content: m.content }))
}

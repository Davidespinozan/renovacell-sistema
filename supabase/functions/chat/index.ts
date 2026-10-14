// Edge Function (se despliega con --no-verify-jwt porque valida el JWT ella misma): CONVERSACIÓN CANÓNICA (CC-2).
//
// DOS PUERTAS (decisiones del dueño, 10 y 13 oct 2026):
//   · Cuentas: el personal y el doctor conversan dentro del sistema (JWT). Desde el 14 oct 2026 (cuenta ≠
//     verificación) el doctor con verificación PENDIENTE también conversa con su asesor; lo que no tiene es precios
//     ni compras, y eso lo deciden la base (puede_ver_precio, crear_pedido) y la audiencia de la IA.
//   · Enlace de contacto (CX-ENLACE): quien entra por el enlace que se comparte en grupos conversa SIN estar
//     verificado, pero solo después de dejar su prerregistro (nombre, celular, correo, aviso de privacidad).
//     Un token de visitante sin prerregistro no abre nada.
// La landing no usa esta función: ahí atiende el agente de orientación (`assistant`).
// El actor lo deriva el servidor: perfil+rol del JWT. Nunca se acepta actor_type,
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
import { resolverQuien, esSesionDeUsuario } from '../_shared/quien.ts'
import { conCors } from '../_shared/cors.ts'
import { limitarTodas, respuestaLimite, sujetoPublico, sujetoUid } from '../_shared/limite.ts'
import { hashToken } from '../_shared/visitante.ts'
import { decodificarFoto } from '../_shared/verificacion.ts'
import { TEXTO_IMAGEN, idImagen, conAdjuntos } from '../_shared/adjuntos.ts'
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

const ACCIONES = new Set(['adjuntar', 'abrir', 'leer', 'enviar', 'leido', 'solicitar_asesor', 'rechazar_asesor', 'asignar', 'iniciar', 'terminar', 'reanudar_ia', 'cerrar', 'reabrir', 'cola', 'sesiones', 'leer_sesion'])   // + Chat V2-C1
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
  let quien: { uid: string; role: string; verified: boolean } | null = null
  if (esSesionDeUsuario(authHeader)) {   // la llave pública del sitio NO es una sesión (ver _shared/quien.ts)
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const q = await resolverQuien(caller, admin)
    if (!q.ok) return json(q.status, q.body)
    quien = { uid: q.quien.uid, role: q.quien.role, verified: q.quien.verified }
  }
  // Puerta de acceso. Se decide ANTES de cualquier comando o del limitador: sin sesión solo pasa un visitante CON
  // prerregistro (lo dice la base, cc_puerta_chat). Con sesión, la cuenta manda.
  const hash: string | null = quien ? null : await hashToken(p.token)
  if (!quien) {
    if (!quien && !hash) return json(401, { error: 'sin_identidad', message: 'Abre la conversación desde el enlace de contacto de Renovacell o inicia sesión.' })
    const { data: puerta, error: ePuerta } = await admin.rpc('cc_puerta_chat', { p_hash: hash, p_profile: null })
    if (ePuerta || !puerta) return json(503, { error: 'no_disponible', message: 'No se pudo completar la operación. Intenta más tarde.' })
    const pu = puerta as { visitante: boolean; prerregistrado: boolean }
    if (!pu.visitante) return json(401, { error: 'sin_identidad', message: 'Tu sesión expiró. Abre de nuevo el enlace de contacto de Renovacell.' })
    if (!pu.prerregistrado) return json(403, { error: 'prerregistro_requerido', message: 'Antes de conversar, déjanos tus datos de contacto.' })
  }
  const actor = derivarActor(quien, hash)
  if (!actor) return json(401, { error: 'sin_identidad', message: 'Inicia sesión o abre la conversación desde el enlace de contacto.' })
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

  // ── Chat V2-C1 · leer UNA sesión (histórica o actual), solo lectura; la base decide la autoridad ──
  if (action === 'leer_sesion') {
    const sesion = typeof p.session_id === 'string' && UUID.test(p.session_id) ? p.session_id : null
    if (!sesion) return json(400, { error: 'falta_sesion', message: 'Falta session_id.' })
    const desde = Number.isFinite(Number(p.desde_seq)) ? Math.max(0, Math.floor(Number(p.desde_seq))) : 0
    const { data, error } = await admin.rpc('cc_sesion_leer', { p_session: sesion, p_actor_type: actor.actor, p_visitor_hash: hash, p_profile: actor.profile, p_desde_seq: desde, p_limite: 100 })
    if (error) return falla(error)
    return json(200, await conAdjuntos(admin, data))   // FOTOS · enlaces temporales a las imágenes de lo que YA se autorizó leer
  }

  if (!conv) return json(400, { error: 'falta_conversacion', message: 'Falta conversation_id.' })
  const base = { p_conv: conv, p_actor_type: actor.actor, p_visitor_hash: hash, p_profile: actor.profile }

  // ── Chat V2-C1 · sesiones autorizadas de la conversación (sin fragmentos de mensajes) ──
  if (action === 'sesiones') {
    const { data, error } = await admin.rpc('cc_sesiones_listar', base)
    if (error) return falla(error)
    return json(200, data)
  }

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
    return json(200, { ...(await conAdjuntos(admin, data) as Record<string, unknown>), cart_id })
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
    // CX-ENLACE-2 · el visitante del enlace de contacto entra a la cola humana con su primer mensaje (su vendedor o
    // Dirección), sin tener que pedirlo; el asistente sigue atendiendo. La base decide si aplica; nunca bloquea el envío.
    if (!r.idempotente && actor.actor === 'visitor' && (r.modo === 'ai_active' || r.modo === 'human_offered')) {
      await admin.rpc('cc_enlace_auto_asesor', { p_conv: conv, p_visitor_hash: hash }).then(() => {}, () => {})
    }
    // Adaptador de IA (solo tras un mensaje del dueño, no idempotente, en modo con IA).
    let ia: 'respondio' | 'no_disponible' | 'silenciada' | 'omitida' | 'descartada' | 'en_curso' | 'limitada' = 'omitida'
    if (!r.idempotente && (actor.actor === 'visitor' || actor.actor === 'doctor')) {
      ia = IA_PUEDE(r.modo) ? await responderIA(admin, conv, r.seq, actor.actor, actor.profile, hash, c.texto, sujeto) : 'silenciada'
    }
    return json(200, { ...r, ia })
  }
  // ── FOTOS · imagen en la conversación: se sube con service_role al bucket privado `chat` y viaja como un mensaje
  //    NORMAL ("Envió una imagen."); la autoridad de quien escribe es la de cc_enviar_mensaje. La IA no responde a fotos.
  if (action === 'adjuntar') {
    const v = await limitarTodas(admin, quien
      ? [{ scope: 'chat_adjuntar_uid', sujeto }, { scope: 'chat_adjuntar_global', sujeto: 'global' }]
      : [{ scope: 'chat_adjuntar', sujeto }, { scope: 'chat_adjuntar_global', sujeto: 'global' }])
    if (!v.permitido) return respuestaLimite(v)
    const foto = decodificarFoto(p.imagen)
    if (!foto || foto === 'invalida') return json(400, { error: 'imagen_invalida', message: 'La imagen debe ser JPG o PNG de menos de 3 MB.' })
    const clientId = idImagen(p.client_message_id)
    const ruta = `${conv}/${crypto.randomUUID()}.${foto.ext}`
    const { error: eSub } = await admin.storage.from('chat').upload(ruta, foto.bytes, { contentType: foto.tipo })
    if (eSub) return json(503, { error: 'no_disponible', message: 'No se pudo subir la imagen. Intenta de nuevo.' })
    const quitar = () => admin.storage.from('chat').remove([ruta]).then(() => {}, () => {})
    const { data, error } = await admin.rpc('cc_enviar_mensaje', { ...base, p_client_id: clientId, p_content: TEXTO_IMAGEN })
    if (error) { await quitar(); return falla(error) }
    const r = data as { id: string; seq: number; idempotente: boolean; modo: string }
    if (r.idempotente) { await quitar(); return json(200, { ...r, ia: 'omitida' }) }   // reintento: la imagen ya quedó con su mensaje
    const { error: eReg } = await admin.rpc('cc_adjunto_registrar', { p_message: r.id, p_ruta: ruta, p_tipo: foto.tipo, p_bytes: foto.bytes.length })
    if (eReg) { await quitar(); return json(503, { error: 'no_disponible', message: 'No se pudo guardar la imagen. Intenta de nuevo.' }) }
    if (actor.actor === 'visitor' && (r.modo === 'ai_active' || r.modo === 'human_offered')) {
      await admin.rpc('cc_enlace_auto_asesor', { p_conv: conv, p_visitor_hash: hash }).then(() => {}, () => {})
    }
    return json(200, { ...r, ia: 'omitida' })
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
// Chat V2-C1 · la base acota el contexto a la SESIÓN del disparador (nunca el transcript eterno).
// deno-lint-ignore no-explicit-any
async function leerInterno(admin: any, conv: string, hastaSeq: number, limite: number): Promise<Array<{ actor: string; content: string }>> {
  const { data, error } = await admin.rpc('cc_ia_contexto', { p_conv: conv, p_hasta_seq: hastaSeq, p_limite: limite })
  if (error) throw new Error('contexto_ia')
  return ((data ?? []) as Array<{ actor: string; content: string }>).map((m) => ({ actor: m.actor, content: m.content }))
}

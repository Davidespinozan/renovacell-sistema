// CC-4 · ORQUESTADOR (puro, sin imports: todo se inyecta). Un turno de IA = reclamar en la base →
// contexto de actor → historial acotado → bucle de herramientas acotado → validar → persistir por
// el comando canónico (que re-verifica el modo bajo lock). El modelo nunca ve autoridad, secrets
// ni ids que no haya devuelto una herramienta; el servidor nunca persiste lo que no pasó la
// validación. Sin prompt, transcript ni razonamiento en ninguna traza.

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
interface Bloque { type: string; [k: string]: unknown }
interface Mensaje { role: 'user' | 'assistant'; content: string | Bloque[] }
interface Solicitud { system: string; messages: Mensaje[]; tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>; max_tokens: number; timeoutMs: number }
type Respuesta =
  | { tipo: 'texto'; texto: string; usage: { input: number; output: number }; stop: string }
  | { tipo: 'herramientas'; texto: string; llamadas: Array<{ id: string; name: string; input: Record<string, unknown> }>; bloques: Bloque[]; usage: { input: number; output: number }; stop: string }
  | { tipo: 'error'; clase: string; usage: { input: number; output: number }; ambiguo: boolean }
interface Ctx { actor: string; audiencia: string; puede_precio: boolean; puede_stock: boolean; puede_pedidos: boolean; verificado: boolean }
type Validada = { ok: true; nombre: string; args: Record<string, unknown>; ids: string[] } | { ok: false; motivo: string }

export interface DepsOrquestador {
  rpc: Rpc
  leerMensajes: (conv: string, hastaSeq: number, limite: number) => Promise<Array<{ actor: string; content: string }>>
  proveedor: { nombre: string; modelo: string; generar: (s: Solicitud) => Promise<Respuesta> }
  config: { maxTokens: number; timeoutMs: number; maxRondas: number; historial: number }
  politica: {
    construirSistema: (e: { ctx: Ctx; intencion: string; limiteClinico: boolean; reglasConocimiento: readonly string[]; evidencia: string[] }) => string
    clasificarIntencion: (t: string) => string; esLimiteClinico: (t: string) => boolean
    historialParaModelo: (m: Array<{ actor: string; content: string }>, maximo?: number) => Array<{ role: 'user' | 'assistant'; content: string }>
    envolverDatos: (etiqueta: string, contenido: string) => string
    MENSAJE_SIN_RESPUESTA: string; MENSAJE_LIMITE_CLINICO: string
  }
  herramientas: {
    herramientasPara: (conCuenta: boolean) => Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
    validarLlamada: (nombre: unknown, input: unknown, ctx: { conCuenta: boolean; idsAutorizados: Set<string> }) => Validada
    acotarSalida: (v: unknown) => string; idsDe: (v: unknown) => string[]; nombresDe: (v: unknown) => string[]
    evidenciaDe: (nombre: string, salida: unknown) => string[]; RECHAZO: Record<string, string>
  }
  validacion: {
    validarRespuesta: (t: unknown, c: { evidencia: readonly string[]; nombresAutorizados: readonly string[]; nombresCatalogo: readonly string[]; limiteClinico: boolean }) => { ok: true; texto: string } | { ok: false; motivo: string; detalle?: string }
    respuestaSegura: (motivo: string, c: { limiteClinico: boolean; evidencia: readonly string[]; textoLimiteClinico: string; textoGenerico: string }) => string
  }
  reglasConocimiento: readonly string[]
  observar?: (accion: string, clasificacion: 'internal_error' | 'provider_error' | 'unknown' | 'rejected', detalle?: { mensaje?: string; code?: string | number }) => void
  ahora?: () => number
}
export interface EntradaTurno { conv: string; triggerSeq: number; actor: 'visitor' | 'doctor'; profile: string | null; visitorHash: string | null; textoUsuario: string }
export interface ResultadoTurno {
  estado: 'respondio' | 'ya_respondido' | 'en_curso' | 'silenciada' | 'descartada' | 'fallo' | 'no_autorizado'
  turnId?: string; intencion?: string; evidencia?: string[]; rondas?: number; usage: { input: number; output: number }; clase?: string; motivoValidacion?: string
}

const LIMITE_RPC: Record<string, number> = { buscar_productos: 10, buscar_conocimiento: 6, candidatos_comerciales: 8 }

export async function ejecutarTurno(e: EntradaTurno, d: DepsOrquestador): Promise<ResultadoTurno> {
  const ahora = d.ahora ?? (() => Date.now()); const inicio = ahora()
  const usage = { input: 0, output: 0 }
  const obs = d.observar ?? (() => {})
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: string | null }> => {
    try { const r = await d.rpc(fn, args); return { data: r.data, error: r.error ? (r.error.message ?? 'error') : null } } catch (x) { return { data: null, error: (x as Error)?.message ?? 'error' } }
  }

  // 1) Contexto del actor: la ÚNICA fuente de audiencia y permisos.
  const cx = await rpc('cc_ia_contexto_actor', { p_profile: e.profile })
  const ctx = (cx.data ?? null) as Ctx | null
  if (cx.error || !ctx || ctx.actor === 'suspendido') return { estado: 'no_autorizado', usage }

  // 2) Reclamar el turno (serializa por conversación; idempotente por disparador).
  const rc = await rpc('cc_ia_turno_reclamar', { p_conv: e.conv, p_trigger_seq: e.triggerSeq, p_provider: d.proveedor.nombre, p_model: d.proveedor.modelo, p_lease_segs: Math.ceil(d.config.timeoutMs / 1000) + 30 })
  const rec = (rc.data ?? {}) as { estado?: string; turn_id?: string }
  if (rc.error) { obs('reclamar', 'internal_error', { code: 'rpc' }); return { estado: 'fallo', clase: 'persistence_error', usage } }
  if (rec.estado === 'ya_completado') return { estado: 'ya_respondido', turnId: rec.turn_id, usage }
  if (rec.estado === 'en_curso') return { estado: 'en_curso', turnId: rec.turn_id, usage }
  if (rec.estado === 'superado') return { estado: 'descartada', clase: 'superado', turnId: rec.turn_id, usage }   // ya hay un disparador más nuevo: no se llama al proveedor
  if (rec.estado === 'silenciado') return { estado: 'silenciada', turnId: rec.turn_id, usage }
  if (rec.estado !== 'reclamado' || !rec.turn_id) return { estado: 'fallo', clase: 'persistence_error', usage }
  const turnId = rec.turn_id

  // 3) Contexto de conversación acotado + intención determinista.
  const intencion = d.politica.clasificarIntencion(e.textoUsuario)
  const limiteClinico = d.politica.esLimiteClinico(e.textoUsuario)
  let historial: Array<{ actor: string; content: string }> = []
  try { historial = await d.leerMensajes(e.conv, e.triggerSeq, 30) } catch { historial = [] }
  const messages: Mensaje[] = d.politica.historialParaModelo(historial, d.config.historial)
  if (!messages.length) messages.push({ role: 'user', content: d.politica.envolverDatos('mensaje_del_usuario', e.textoUsuario.slice(0, 2000)) })

  // Nombres del catálogo visible (solo para la guarda anti-alucinación; NO van al prompt).
  const cat = await rpc('cc_catalogo_para_ia', { p_audiencia: ctx.audiencia, p_limite: 400 })
  const nombresCatalogo = Array.isArray(cat.data) ? (cat.data as Array<{ nombre?: string }>).map((p) => String(p.nombre ?? '')).filter(Boolean) : []

  const conCuenta = ctx.actor !== 'visitor'
  const tools = d.herramientas.herramientasPara(conCuenta)
  const idsAutorizados = new Set<string>(); const nombresAutorizados = new Set<string>(); const evidencia: string[] = []
  const carrito = { id: null as string | null }   // CC-5 · se abre perezosamente con la primera herramienta de carrito
  const addEv = (xs: string[]) => { for (const x of xs) if (!evidencia.includes(x)) evidencia.push(x) }
  const fallar = async (clase: string, ambiguo: boolean, rondas: number): Promise<ResultadoTurno> => {
    await rpc('cc_ia_turno_fallar', { p_turn: turnId, p_error_class: clase, p_desconocido: ambiguo, p_intent: intencion, p_tool_rounds: rondas, p_input_tokens: usage.input, p_output_tokens: usage.output })
    await rpc('cc_ia_aviso_no_disponible', { p_conv: e.conv })   // una vez por conversación (client_id fijo)
    obs('proveedor', clase.startsWith('provider') ? 'provider_error' : 'internal_error', { code: clase })
    return { estado: 'fallo', clase, turnId, intencion, evidencia, rondas, usage }
  }
  const persistir = async (texto: string, rondas: number, motivoValidacion?: string): Promise<ResultadoTurno> => {
    const pr = await rpc('cc_ia_turno_responder', { p_turn: turnId, p_content: texto, p_intent: intencion, p_evidencia: evidencia, p_tool_rounds: rondas, p_input_tokens: usage.input, p_output_tokens: usage.output })
    const p = (pr.data ?? {}) as { persistido?: boolean; motivo?: string }
    if (pr.error) { obs('persistir', 'internal_error', { code: 'rpc' }); return { estado: 'fallo', clase: 'persistence_error', turnId, intencion, evidencia, rondas, usage, motivoValidacion } }
    // CC-5 · la elegibilidad la decidió el servidor (mutación); se registra la oferta solo si la respuesta se persistió.
    if (p.persistido && evidencia.includes('SELLER_OFFER_ELIGIBLE') && carrito.id && !motivoValidacion) {
      await rpc('cc_carrito_oferta', { p_cart: carrito.id, p_actor_type: 'ai', p_visitor_hash: e.visitorHash, p_profile: e.actor === 'doctor' ? e.profile : null, p_accion: 'ofrecer' })
    }
    return { estado: p.persistido ? 'respondio' : 'descartada', turnId, intencion, evidencia, rondas, usage, clase: p.persistido ? undefined : p.motivo, motivoValidacion }
  }

  // 4) Bucle de herramientas acotado.
  for (let ronda = 0; ronda < d.config.maxRondas; ronda++) {
    const restante = d.config.timeoutMs - (ahora() - inicio)
    if (restante < 1500) return await fallar('provider_timeout', ronda > 0, ronda)
    const system = d.politica.construirSistema({ ctx, intencion, limiteClinico, reglasConocimiento: d.reglasConocimiento, evidencia })
    const r = await d.proveedor.generar({ system, messages, tools, max_tokens: d.config.maxTokens, timeoutMs: restante })
    usage.input += r.usage?.input ?? 0; usage.output += r.usage?.output ?? 0
    if (r.tipo === 'error') return await fallar(r.clase, r.ambiguo, ronda)

    if (r.tipo === 'texto') {
      const v = d.validacion.validarRespuesta(r.texto, { evidencia, nombresAutorizados: [...nombresAutorizados], nombresCatalogo, limiteClinico })
      if (v.ok) return await persistir(v.texto, ronda)
      await rpc('cc_ia_herramienta_registrar', { p_turn: turnId, p_round: ronda, p_tool: 'validacion_salida', p_status: 'rechazada', p_product_ids: [], p_detalle: { motivo: v.motivo } })
      obs('validacion', 'rejected', { code: v.motivo })
      return await persistir(d.validacion.respuestaSegura(v.motivo, { limiteClinico, evidencia, textoLimiteClinico: d.politica.MENSAJE_LIMITE_CLINICO, textoGenerico: d.politica.MENSAJE_SIN_RESPUESTA }), ronda, v.motivo)
    }

    // Herramientas: validar → autorizar → ejecutar → acotar → devolver como DATA.
    messages.push({ role: 'assistant', content: r.bloques })
    const resultados: Bloque[] = []
    for (const ll of r.llamadas) {
      const v = d.herramientas.validarLlamada(ll.name, ll.input, { conCuenta, idsAutorizados })
      if (!v.ok) {
        await rpc('cc_ia_herramienta_registrar', { p_turn: turnId, p_round: ronda, p_tool: String(ll.name).slice(0, 60), p_status: v.motivo === 'no_autorizada' || v.motivo === 'id_no_autorizado' ? 'no_autorizada' : 'rechazada', p_product_ids: [], p_detalle: { motivo: v.motivo } })
        resultados.push({ type: 'tool_result', tool_use_id: ll.id, content: d.politica.envolverDatos('resultado', JSON.stringify({ error: d.herramientas.RECHAZO[v.motivo] ?? 'rechazada' })) })
        continue
      }
      const ej = await ejecutar(v, e, ctx, rpc, { turnId, ronda, carrito })
      const salida = ej.error ? { error: 'Herramienta no disponible en este momento. No inventes el dato.' } : ej.data
      if (!ej.error) { for (const id of d.herramientas.idsDe(ej.data)) idsAutorizados.add(id); for (const n of d.herramientas.nombresDe(ej.data)) nombresAutorizados.add(n); addEv(d.herramientas.evidenciaDe(v.nombre, ej.data)) }
      const ev = ej.error ? [] : d.herramientas.evidenciaDe(v.nombre, ej.data)
      await rpc('cc_ia_herramienta_registrar', { p_turn: turnId, p_round: ronda, p_tool: v.nombre, p_status: ej.error ? 'error' : (ev.length ? 'ok' : 'vacia'), p_product_ids: v.ids, p_detalle: ej.error ? { motivo: 'rpc' } : { n: d.herramientas.idsDe(ej.data).length, evidencia: ev } })
      if (ej.error) obs('herramienta', 'internal_error', { code: v.nombre })
      resultados.push({ type: 'tool_result', tool_use_id: ll.id, content: d.politica.envolverDatos('resultado_' + v.nombre, d.herramientas.acotarSalida(salida)) })
    }
    if (ronda === d.config.maxRondas - 1) resultados.push({ type: 'text', text: 'Ya no hay más herramientas disponibles en este turno. Responde ahora al usuario con lo que tienes.' })
    messages.push({ role: 'user', content: resultados })
  }
  // Rondas agotadas con el modelo aún pidiendo herramientas → respuesta segura (nunca inventada).
  obs('rondas', 'rejected', { code: 'max_rondas' })
  return await persistir(d.validacion.respuestaSegura('rondas', { limiteClinico, evidencia, textoLimiteClinico: d.politica.MENSAJE_LIMITE_CLINICO, textoGenerico: d.politica.MENSAJE_SIN_RESPUESTA }), d.config.maxRondas, 'rondas')
}

async function ejecutar(v: { nombre: string; args: Record<string, unknown> }, e: EntradaTurno, ctx: Ctx, rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: string | null }>, t: { turnId: string; ronda: number; carrito: { id: string | null } }): Promise<{ data: unknown; error: string | null }> {
  const a = v.args
  const dueno = { p_actor_type: e.actor, p_visitor_hash: e.visitorHash, p_profile: e.actor === 'doctor' ? e.profile : null }
  // CC-5 · carrito del dueño ligado a la conversación; operation_id estable = turno + llamada (un reintento no duplica).
  const abrirCarrito = async (): Promise<string | null> => {
    if (t.carrito.id) return t.carrito.id
    const r = await rpc('cc_carrito_abrir', { ...dueno, p_conv: e.conv })
    const id = (r.data as { cart_id?: string } | null)?.cart_id ?? null
    if (id) t.carrito.id = id
    return id
  }
  // operation_id ESTABLE ante reintentos del turno: turno + ronda + herramienta + hash de args. Un re-run
  // del mismo turno (tras timeout) que vuelva a pedir la misma mutación cae en el mismo id → la base
  // devuelve el resultado cacheado (nunca X×4). Dos llamadas idénticas en la misma ronda también.
  const op = `${t.turnId}:r${t.ronda}:${v.nombre}:${huella(JSON.stringify(a))}`
  if (['ver_carrito', 'agregar_al_carrito', 'actualizar_carrito', 'quitar_del_carrito', 'vaciar_carrito', 'declinar_asesor', 'preparar_checkout'].includes(v.nombre)) {
    const cart = await abrirCarrito(); if (!cart) return { data: null, error: 'carrito' }
    switch (v.nombre) {
      case 'ver_carrito': return rpc('cc_carrito_ver', { p_cart: cart, ...dueno })
      case 'agregar_al_carrito': return rpc('cc_carrito_agregar', { p_cart: cart, p_actor_type: 'ai', p_visitor_hash: e.visitorHash, p_profile: dueno.p_profile, p_product: a.product_id, p_qty: a.cantidad, p_op: op })
      case 'actualizar_carrito': return rpc('cc_carrito_actualizar', { p_cart: cart, p_actor_type: 'ai', p_visitor_hash: e.visitorHash, p_profile: dueno.p_profile, p_product: a.product_id, p_qty: a.cantidad, p_op: op })
      case 'quitar_del_carrito': return rpc('cc_carrito_quitar', { p_cart: cart, p_actor_type: 'ai', p_visitor_hash: e.visitorHash, p_profile: dueno.p_profile, p_product: a.product_id, p_op: op })
      case 'vaciar_carrito': return rpc('cc_carrito_vaciar', { p_cart: cart, p_actor_type: 'ai', p_visitor_hash: e.visitorHash, p_profile: dueno.p_profile, p_op: op })
      case 'declinar_asesor': return rpc('cc_carrito_oferta', { p_cart: cart, p_actor_type: 'ai', p_visitor_hash: e.visitorHash, p_profile: dueno.p_profile, p_accion: 'rechazar' })
      case 'preparar_checkout': return rpc('cc_carrito_preparar_checkout', { p_cart: cart, ...dueno })   // CC-6 · lectura; confirmar NO es una herramienta
    }
  }
  switch (v.nombre) {
    case 'buscar_productos': return rpc('cc_buscar_productos', { p_q: a.consulta, p_limite: LIMITE_RPC.buscar_productos, p_audiencia: ctx.audiencia })
    case 'obtener_ficha_producto': return rpc('cc_ficha_producto', { p_product: a.product_id, p_audiencia: ctx.audiencia })
    case 'comparar_productos': return rpc('cc_comparar_productos', { p_ids: a.product_ids, p_audiencia: ctx.audiencia })
    case 'buscar_conocimiento': return rpc('cc_buscar_conocimiento', { p_q: a.consulta, p_limite: LIMITE_RPC.buscar_conocimiento, p_audiencia: ctx.audiencia })
    case 'candidatos_comerciales': return rpc('cc_candidatos_recomendacion', { p_categoria: a.categoria, p_familia: a.familia, p_terminos: a.terminos, p_limite: LIMITE_RPC.candidatos_comerciales, p_audiencia: ctx.audiencia })
    case 'obtener_precio': return rpc('cc_ia_precio', { p_profile: e.profile, p_product: a.product_id, p_qty: a.cantidad })
    case 'obtener_disponibilidad': return rpc('cc_ia_disponibilidad', { p_profile: e.profile, p_product: a.product_id })
    case 'obtener_estado_pedido': return rpc('cc_ia_estado_pedido', { p_profile: e.profile, p_folio: a.folio })
    case 'solicitar_asesor': {
      const r = await rpc('cc_solicitar_asesor', { p_conv: e.conv, p_actor_type: e.actor, p_visitor_hash: e.visitorHash, p_profile: dueno.p_profile })
      // CC-5 · aceptación de la oferta de asesor (si había una): el handoff sigue siendo el de CC-2.
      if (!r.error) { const cart = t.carrito.id ?? (await abrirCarrito()); if (cart) await rpc('cc_carrito_oferta', { p_cart: cart, p_actor_type: 'ai', p_visitor_hash: e.visitorHash, p_profile: dueno.p_profile, p_accion: 'aceptar' }) }
      return r
    }
    default: return { data: null, error: 'desconocida' }
  }
}

/** Huella corta y determinista (djb2) para derivar operation_id sin dependencias. */
function huella(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

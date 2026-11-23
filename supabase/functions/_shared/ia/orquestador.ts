// CC-4 · ORQUESTADOR (puro, sin imports: todo se inyecta). Un turno de IA = reclamar en la base →
// contexto de actor → historial acotado → bucle de herramientas acotado → validar → persistir por
// el comando canónico (que re-verifica el modo bajo lock). El modelo nunca ve autoridad, secrets
// ni ids que no haya devuelto una herramienta; el servidor nunca persiste lo que no pasó la
// validación. Sin prompt, transcript ni razonamiento en ninguna traza.

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
interface Bloque { type: string; [k: string]: unknown }
interface Mensaje { role: 'user' | 'assistant'; content: string | Bloque[] }
interface Solicitud { system: string; systemFijo?: number; messages: Mensaje[]; tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>; max_tokens: number; timeoutMs: number }
type Respuesta =
  | { tipo: 'texto'; texto: string; usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }; stop: string }
  | { tipo: 'herramientas'; texto: string; llamadas: Array<{ id: string; name: string; input: Record<string, unknown> }>; bloques: Bloque[]; usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }; stop: string }
  | { tipo: 'error'; clase: string; usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }; ambiguo: boolean }
interface Ctx { actor: string; audiencia: string; puede_precio: boolean; puede_stock: boolean; puede_pedidos: boolean; verificado: boolean; clinico?: boolean }
type Validada = { ok: true; nombre: string; args: Record<string, unknown>; ids: string[] } | { ok: false; motivo: string }

export interface DepsOrquestador {
  rpc: Rpc
  leerMensajes: (conv: string, hastaSeq: number, limite: number) => Promise<Array<{ actor: string; content: string }>>
  proveedor: { nombre: string; modelo: string; generar: (s: Solicitud) => Promise<Respuesta> }
  config: { maxTokens: number; timeoutMs: number; maxRondas: number; historial: number }
  politica: {
    construirSistema: (e: { ctx: Ctx; intencion: string; limiteClinico: boolean; reglasConocimiento: readonly string[]; evidencia: string[]; canal?: CanalTurno; contacto?: EntradaTurno['contacto'] }) => string
    clasificarIntencion: (t: string) => string; esLimiteClinico: (t: string) => boolean
    historialParaModelo: (m: Array<{ actor: string; content: string }>, maximo?: number) => Array<{ role: 'user' | 'assistant'; content: string }>
    envolverDatos: (etiqueta: string, contenido: string) => string
    MENSAJE_SIN_RESPUESTA: string; MENSAJE_LIMITE_CLINICO: string
    MARCA_VARIABLE?: string   // CACHÉ · dónde empieza lo que cambia en cada ronda
    // R4-C14 · opcional: pre-búsqueda determinista de los productos que nombró el cliente (canal)
    esConfirmacionExplicita?: (texto: string) => boolean   // PEDIDO POR WHATSAPP · el "sí" del doctor (determinista)
    prebuscarProductos?: (texto: string, buscar: (q: string) => PromiseLike<{ data: unknown; error: unknown }>, parecidos?: Array<{ product_id: string; nombre: string }>) => Promise<Array<{ product_id: string; nombre: string }>>
  }
  herramientas: {
    herramientasPara: (conCuenta: boolean, canal?: CanalTurno, contactoPendiente?: boolean, identificado?: boolean) => Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
    validarLlamada: (nombre: unknown, input: unknown, ctx: { conCuenta: boolean; idsAutorizados: Set<string>; canal?: CanalTurno; contactoPendiente?: boolean; identificado?: boolean }) => Validada
    ejecutarEnlacePortal?: () => { url: string; uso: string }
    acotarSalida: (v: unknown, max?: number) => string; limiteSalida?: (nombre: string) => number; idsDe: (v: unknown) => string[]; nombresDe: (v: unknown) => string[]
    evidenciaDe: (nombre: string, salida: unknown) => string[]; RECHAZO: Record<string, string>
    // CAJAS-MEDIOS · opcional: cajas del modelo ↔ medias cajas internas
    argsAInterno?: (nombre: string, a: Record<string, unknown>, media: ReadonlySet<string>) => { ok: true; args: Record<string, unknown> } | { ok: false }
    salidaEnCajas?: (x: unknown, media: ReadonlySet<string>) => unknown
    evidenciaHandoff?: (estado: unknown) => string[]   // CC-7 · estado de atención humana (servidor)
    // ENT-P · opcional: completa la salida de una herramienta con datos del negocio (p. ej. envío gratis del carrito)
    complementar?: (nombre: string, salida: unknown) => unknown
  }
  validacion: {
    validarRespuesta: (t: unknown, c: { evidencia: readonly string[]; nombresAutorizados: readonly string[]; nombresCatalogo: readonly string[]; limiteClinico: boolean }) => { ok: true; texto: string } | { ok: false; motivo: string; detalle?: string }
    respuestaSegura: (motivo: string, c: { limiteClinico: boolean; evidencia: readonly string[]; textoLimiteClinico: string; textoGenerico: string; rafaga?: string; reconocido?: boolean; asesor?: string | null }) => string
  }
  reglasConocimiento: readonly string[]
  observar?: (accion: string, clasificacion: 'internal_error' | 'provider_error' | 'unknown' | 'rejected', detalle?: { mensaje?: string; code?: string | number }) => void
  ahora?: () => number
  // TANDA 1 (23 nov 2026) · opcional: conversación natural (./conversacion.ts). Sin ella, el turno se comporta como antes.
  conversacion?: Conversacion
  // TANDA 1 · 1 · antes de publicar: ¿llegó otro mensaje del cliente y ya arrancó su turno? (la base descarta el viejo)
  esperaPublicar?: { hayNuevo: (conv: string, seq: number) => Promise<boolean>; turnoNuevo: (conv: string, seq: number) => Promise<boolean>; dormir: (ms: number) => Promise<void> }
}
type MensajeH = { actor: string; content: string; seq?: number }
type Estado = { yaSaludo: boolean; promoDicha: boolean; horarioDicho: boolean; pedidosCedula: number; respuestasIA: number; dijoCliente: boolean }
type CtxRev = { estado: Estado; rafaga: string; verificarDatos: boolean; reconocido: boolean; limite: number | null; nombresProducto?: readonly string[] }
export interface Conversacion {
  rafagaPendiente(h: readonly MensajeH[]): string[]
  historialPrevio(h: readonly MensajeH[]): MensajeH[]
  estadoConversacion(previo: readonly MensajeH[], rafaga?: readonly string[]): Estado
  textoEstadoConversacion(e: Estado, o: { rafaga: number; verificarDatos: boolean }): string
  textoClienteReconocido(e: { porServidor: boolean; porCliente: boolean; asesor?: string | null }): string | null
  textoReconocidoRespaldo(asesor?: string | null): string
  revisarRespuesta(t: string, c: CtxRev): { texto: string; problemas: readonly string[] }
  notaEstilo(ps: readonly string[], limite: number | null): string
  recortar(t: string, c: CtxRev): string
  datosPedidos(t: string): Set<string>
  decidirPublicar(e: { hayNuevo: boolean; turnoNuevo: boolean; esperadoMs: number; maxMs?: number }): 'publicar' | 'esperar' | 'ceder'
  nombresQueEscribioElCliente(nombresCatalogo: readonly string[], textosCliente: readonly string[]): string[]
  ESTILO_MENSAJE: string; LIMITE_CANAL: number; LIMITE_CANAL_RESUMEN: number
  // TANDA 2 (opcionales: sin ellos el turno se comporta como en la Tanda 1)
  existenciaVacia?(): Existencia
  sumarExistencia?(acc: Existencia, estado: unknown): Existencia
  notaExistencia?(estado: unknown): string | null
  consultasExistencia?(texto: string): string[]
  revisarTanda2?(t: string, c: CtxT2): { texto: string; problemas: readonly string[] }
  notaTanda2?(ps: readonly string[], ex?: Existencia | null): string
  corregirTanda2?(t: string, ps: readonly string[], c: CtxT2, asesor?: string | null): string
  tipoContacto?(textos: readonly string[]): string | null
  textoTipoContacto?(tipo: string | null): string | null
  tratoCliente?(textos: readonly string[], nombreCuenta?: string | null): TratoT
  textoTrato?(t: TratoT): string
  medioSinTexto?(rafaga: readonly string[]): 'audio' | 'video' | null
  textoAudio?(tipo: 'audio' | 'video', yaSaludo: boolean): string
  equipoIncluyoEnvio?(previo: readonly MensajeH[]): boolean
  hablaronDePago?(previo: readonly MensajeH[], rafaga: string): boolean
}
type Existencia = { confirmados: string[]; sinExistencia: string[]; presentacionNo: string[]; noEncontrado: string[]; alternativas: string[] }
type TratoT = { trato: 'doctora' | 'doctor' | null; nombre: string | null }
type CtxT2 = { existencia?: Existencia | null; adjuntoVisto?: boolean; hablaronDePago?: boolean; tipo?: string | null; trato?: TratoT | null; envioIncluido?: boolean; rafaga?: string; canal?: boolean; resumenPedido?: boolean }
// LIVE C1 · `canal`: 'portal' (sesión del portal, por defecto) o un canal de Meta. Fuera del portal el PERFIL NUNCA llega a la
// IA (audiencia pública, sin herramientas de cuenta ni carrito) aunque la conversación pertenezca a un doctor: la
// vinculación comercial (cartera, asesor) se conserva en la conversación; la elevación de permisos solo existe con sesión.
export type CanalTurno = 'portal' | 'whatsapp' | 'instagram' | 'messenger'
// R4-C13 · `adjunto`: imagen o PDF del cliente en ESTE turno (canal); va junto a su último mensaje y no se persiste.
export interface EntradaTurno { conv: string; triggerSeq: number; actor: 'visitor' | 'doctor'; profile: string | null; visitorHash: string | null; textoUsuario: string; canal?: CanalTurno; adjunto?: { tipo: 'image' | 'document'; media_type: string; data: string }
  // CONTACTO CONVERSACIONAL · visitante del enlace del chat sin datos todavía (lo dice el servidor): la IA los pide y los registra
  contacto?: { pendiente: boolean; asesor?: string | null; recomienda?: string | null } | null }
export interface ResultadoTurno {
  estado: 'respondio' | 'ya_respondido' | 'en_curso' | 'silenciada' | 'descartada' | 'fallo' | 'no_autorizado'
  turnId?: string; intencion?: string; evidencia?: string[]; rondas?: number; usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }; clase?: string; motivoValidacion?: string
  reconocido?: boolean   // TANDA 1 · 2 · cliente reconocido en canal: responder.ts le avisa a su asesor (señal de interés)
}

// Qué no puede afirmar sin evidencia, dicho al modelo en la corrección interna (una sola por turno).
const CORRECCION: Record<string, string> = {
  stock_sin_evidencia: 'afirmaba existencias o disponibilidad sin consultar obtener_disponibilidad en este turno. Si no hace falta para responder, no hables de existencias.',
  carrito_mutacion_sin_evidencia: 'decía que agregaste, quitaste o cambiaste algo en el carrito sin que la herramienta del carrito lo confirmara. Si quieres ofrecerlo, pregúntale si lo agregas.',
  carrito_lectura_sin_evidencia: 'describía su carrito sin haberlo consultado con ver_carrito.',
  precio_sin_evidencia: 'mencionaba montos que no vienen de obtener_precio, cotizar o del perfil del cliente en este turno. Consulta el precio antes de dar cifras.',
  clinico_sin_evidencia: 'daba cifras clínicas (unidades, ml, dosis) sin haber consultado la ficha aprobada con obtener_ficha_producto en este turno.',
  pedido_sin_evidencia: 'decía que un pedido quedó creado o confirmado, y tú no creas pedidos.',
  promesa_humano_sin_evidencia: 'prometía que un asesor ya atiende o responderá, y eso solo lo dice el servidor.',
  // TANDA 2 · 7 · la única dirección para clientes es la de la sucursal (la fiscal está en remodelación)
  direccion_anterior: 'daba una dirección que ya no es donde se atiende: la ÚNICA dirección para clientes es la de la sucursal del bloque negocio.',
}

const LIMITE_RPC: Record<string, number> = { buscar_productos: 10, buscar_conocimiento: 6, candidatos_comerciales: 8 }

export async function ejecutarTurno(e: EntradaTurno, d: DepsOrquestador): Promise<ResultadoTurno> {
  const ahora = d.ahora ?? (() => Date.now()); const inicio = ahora()
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const obs = d.observar ?? (() => {})
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: string | null }> => {
    try { const r = await d.rpc(fn, args); return { data: r.data, error: r.error ? (r.error.message ?? 'error') : null } } catch (x) { return { data: null, error: (x as Error)?.message ?? 'error' } }
  }

  // 1) Contexto del actor: la ÚNICA fuente de audiencia y permisos.
  //    LIVE C1 · fuera del portal el perfil no se entrega: la IA habla con audiencia pública, sin excepciones.
  const canal: CanalTurno = e.canal ?? 'portal'
  // IA MEJOR QUE EL HUMANO · E (2 nov 2026): en WhatsApp, SOLO con vínculo explícito (código desde su sesión o Dirección) la base
  // dice qué doctor es (cc_ia_identidad_canal); un número que coincide no prueba nada (R4-B1). Instagram/Messenger, nunca.
  let perfilIA: string | null = canal === 'portal' ? e.profile : null
  if (canal === 'whatsapp') { const idc = await rpc('cc_ia_identidad_canal', { p_conv: e.conv }); if (!idc.error && typeof idc.data === 'string') perfilIA = idc.data }
  const identificado = canal !== 'portal' && !!perfilIA
  // CAJAS-MEDIOS · productos que se guardan por media caja: la IA habla en cajas (ver ./cajas.ts).
  const mc = await rpc('cc_ia_media_caja', {})
  const mediaCaja = new Set<string>(Array.isArray(mc.data) ? (mc.data as unknown[]).map(String) : [])
  const cx = await rpc('cc_ia_contexto_actor', { p_profile: perfilIA })
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
  let historial: Array<{ actor: string; content: string }> = []
  try { historial = await d.leerMensajes(e.conv, e.triggerSeq, 30) } catch { historial = [] }
  // TANDA 1 · 1 · el turno contesta TODO lo que el cliente mandó seguido desde la última respuesta («Tiene linurasse» + «?»):
  // la intención, el límite clínico y la pre-búsqueda miran la ráfaga completa, no solo el último mensaje.
  const cv = d.conversacion
  const rafaga = cv ? cv.rafagaPendiente(historial) : []
  const textoTurno = rafaga.length > 1 ? rafaga.join('\n') : e.textoUsuario
  // la pre-búsqueda toma pocas palabras: primero las del mensaje más reciente («…una toxina» + «Xeomeen» + «100 u» → Xeomeen)
  const textoPrebusqueda = rafaga.length > 1 ? [...rafaga].reverse().join(' . ') : e.textoUsuario
  const intencion = d.politica.clasificarIntencion(textoTurno)
  // IA-CLÍNICA · con información clínica habilitada para ESTE actor (lo dice la base) la pregunta de etiqueta se responde con
  // las secciones aprobadas; el límite fijo queda para quien no puede verlas.
  const limiteClinico = d.politica.esLimiteClinico(textoTurno) && !ctx.clinico
  const messages: Mensaje[] = d.politica.historialParaModelo(historial, d.config.historial)
  if (!messages.length) messages.push({ role: 'user', content: d.politica.envolverDatos('mensaje_del_usuario', e.textoUsuario.slice(0, 2000)) })
  const ultimo = messages[messages.length - 1]
  if (e.adjunto && (e.canal ?? 'portal') !== 'portal' && ultimo.role === 'user' && typeof ultimo.content === 'string') {
    ultimo.content = [{ type: e.adjunto.tipo, source: { type: 'base64', media_type: e.adjunto.media_type, data: e.adjunto.data } } as unknown as Bloque, { type: 'text', text: ultimo.content } as Bloque]
  }

  // Nombres del catálogo visible (solo para la guarda anti-alucinación; NO van al prompt).
  const cat = await rpc('cc_catalogo_para_ia', { p_audiencia: ctx.audiencia, p_limite: 400 })
  const nombresCatalogo = Array.isArray(cat.data) ? (cat.data as Array<{ nombre?: string }>).map((p) => String(p.nombre ?? '')).filter(Boolean) : []

  const conCuenta = ctx.actor !== 'visitor'
  const contactoPendiente = !!e.contacto?.pendiente && e.actor === 'visitor' && canal === 'portal'
  const tools = d.herramientas.herramientasPara(conCuenta, canal, contactoPendiente, identificado)
  const idsAutorizados = new Set<string>(); const nombresAutorizados = new Set<string>(); const evidencia: string[] = []
  const carrito = { id: null as string | null }   // CC-5 · se abre perezosamente con la primera herramienta de carrito
  const addEv = (xs: string[]) => { for (const x of xs) if (!evidencia.includes(x)) evidencia.push(x) }
  // TANDA 2 · 3 · lo que el servidor dijo en este turno de lo que pidió (existencia sí/no, presentación, alternativas)
  const t2 = !!(cv && cv.existenciaVacia && cv.sumarExistencia && cv.revisarTanda2)
  const existencia: Existencia | null = t2 ? cv!.existenciaVacia!() : null
  const estadoProducto = t2 ? async (q: string, hayResultados: boolean): Promise<unknown> => {
    const est = await rpc('cc_ia_producto_estado', { p_q: q, p_audiencia: ctx.audiencia })
    if (est.error || !est.data || typeof est.data !== 'object') return null
    // «no aparece» solo cuenta si la búsqueda tampoco encontró nada (una categoría o un texto aprobado sí son evidencia)
    if ((est.data as { coincidencia?: string }).coincidencia === 'ninguna' && hayResultados) return null
    cv!.sumarExistencia!(existencia!, est.data)
    for (const id of d.herramientas.idsDe(est.data)) idsAutorizados.add(id); for (const n of d.herramientas.nombresDe(est.data)) nombresAutorizados.add(n)
    if (existencia!.sinExistencia.length || existencia!.presentacionNo.length) addEv(['SIN_EXISTENCIA_EVIDENCE'])
    return est.data
  } : null
  // R4-C14 · canal: los productos que el cliente nombró ya vienen buscados (no depende de que el modelo decida buscar)
  let productosMencionados = ''
  if (canal !== 'portal' && d.politica.prebuscarProductos) {
    const parecidos: Array<{ product_id: string; nombre: string }> = []
    const pre = await d.politica.prebuscarProductos(textoPrebusqueda, (q) => rpc('cc_buscar_productos', { p_q: q, p_limite: 5, p_audiencia: ctx.audiencia }), ...(t2 ? [parecidos] : []))
    if (pre.length) {
      for (const id of d.herramientas.idsDe(pre)) idsAutorizados.add(id); for (const n of d.herramientas.nombresDe(pre)) nombresAutorizados.add(n)
      addEv(d.herramientas.evidenciaDe('buscar_productos', pre))
      productosMencionados = '\n\n' + d.politica.envolverDatos('productos_del_catalogo_que_menciono_el_cliente', d.herramientas.acotarSalida(pre)) +
        '\nEstos productos de NUESTRO catálogo coinciden con lo que escribió el cliente (ya los busqué por ti): reconócelos por su nombre y confírmalos con naturalidad.'
    }
    // TANDA 2 · 3 · lo que escribió con error de dedo («Xomeen», «linurasse»): posibles, nunca confirmados solos
    if (parecidos.length) {
      for (const id of d.herramientas.idsDe(parecidos)) idsAutorizados.add(id); for (const n of d.herramientas.nombresDe(parecidos)) nombresAutorizados.add(n)
      productosMencionados += '\n\n' + d.politica.envolverDatos('productos_parecidos_a_lo_que_escribio', d.herramientas.acotarSalida(parecidos)) +
        '\nLo que escribió se PARECE a estos productos (pudo ser un error de dedo): pregúntale si se refiere a alguno antes de afirmarlo.'
    }
    // TANDA 2 · 3 · presentaciones que pidió («nabota de 200 unidades»): si se puede surtir, si esa presentación existe, alternativas
    if (estadoProducto && cv!.consultasExistencia && cv!.notaExistencia) {
      const notas: string[] = []
      for (const q of cv!.consultasExistencia(textoPrebusqueda)) {
        const est = await estadoProducto(q, pre.length > 0)
        const nota = est ? cv!.notaExistencia(est) : null
        if (est && nota) notas.push(d.politica.envolverDatos('existencia_de_lo_que_pidio', d.herramientas.acotarSalida(est)) + '\n' + nota)
      }
      if (notas.length) productosMencionados += '\n\n' + notas.join('\n\n')
    }
  }
  // EXPEDIENTE · los productos que el cliente nombró ANTES en esta conversación también cuentan como consultados: la IA puede
  // retomarlos ("su Dysport de 500") sin que la guarda la bloquee. Solo autorizan nombres; no entran al prompt.
  if (canal !== 'portal' && d.politica.prebuscarProductos) {
    const previos = historial.filter((m) => m.actor === 'visitor' || m.actor === 'doctor').slice(-6, -1).map((m) => m.content).join(' . ')
    if (previos.trim()) {
      const pre = await d.politica.prebuscarProductos(previos, (q) => rpc('cc_buscar_productos', { p_q: q, p_limite: 5, p_audiencia: ctx.audiencia }))
      for (const id of d.herramientas.idsDe(pre)) idsAutorizados.add(id); for (const n of d.herramientas.nombresDe(pre)) nombresAutorizados.add(n)
    }
  }
  // IA-VENDEDORA · perfil comercial del cliente (solo portal y con precio autorizado: doctor verificado). Lo arma el servidor:
  // tipo de cliente, especialidad, lo que compra, su carrito con oportunidades y lo que buscó en el catálogo. Sus productos
  // cuentan como consultados en este turno y sus montos como precio autorizado (vienen de la misma autoridad que obtener_precio).
  let perfilComercial = ''
  if ((canal === 'portal' || identificado) && ctx.puede_precio && perfilIA) {
    const pc = await rpc('cc_ia_perfil_comercial', { p_profile: perfilIA })
    if (!pc.error && pc.data && typeof pc.data === 'object') {
      for (const id of d.herramientas.idsDe(pc.data)) idsAutorizados.add(id); for (const n of d.herramientas.nombresDe(pc.data)) nombresAutorizados.add(n)
      addEv(['PRICE_EVIDENCE'])
      // su carrito viene en el perfil (lo arma el servidor): describirlo no es inventarlo
      if (Array.isArray((pc.data as { carrito?: unknown }).carrito) && ((pc.data as { carrito: unknown[] }).carrito.length > 0)) addEv(['CART_READ_EVIDENCE'])
      perfilComercial = '\n\n' + d.politica.envolverDatos('perfil_comercial_del_cliente', d.herramientas.acotarSalida(d.herramientas.salidaEnCajas ? d.herramientas.salidaEnCajas(pc.data, mediaCaja) : pc.data))   /* CAJAS-MEDIOS */
    }
  }
  // CC-7 · lo que el servidor sabe de la atención humana (horario, ruteo, rechazo) entra como EVIDENCIA, no como inferencia.
  let estadoAtencion: Record<string, unknown> = {}
  if (d.herramientas.evidenciaHandoff) {
    const hs = await rpc('cc_ia_estado_handoff', { p_conv: e.conv })
    if (!hs.error) { addEv(d.herramientas.evidenciaHandoff(hs.data)); if (hs.data && typeof hs.data === 'object') estadoAtencion = hs.data as Record<string, unknown> } else addEv(['HORARIO_DESCONOCIDO'])   // sin dato: nunca prometer
  }
  // TANDA 1 · 2 y 4 · lo que ya pasó en la conversación (saludo, promo, horario, cédula pedida) y si el cliente ya es conocido.
  // CLIENTE RECONOCIDO solo en canal sin vínculo: deja de pedir datos y lo encamina con su asesor; NO abre precios ni datos
  // (R4-B1: el perfil de la IA sigue siendo público; esto solo cambia qué le pide y a quién lo pasa).
  const enCanalSinVinculo = canal !== 'portal' && !identificado
  const estadoConv = cv ? cv.estadoConversacion(cv.historialPrevio(historial), rafaga) : null
  const reconocidoServidor = enCanalSinVinculo && estadoAtencion.cliente_reconocido === true
  const reconocido = enCanalSinVinculo && (reconocidoServidor || !!estadoConv?.dijoCliente)
  const asesorNombre = enCanalSinVinculo && typeof estadoAtencion.asesor_nombre === 'string' && estadoAtencion.asesor_nombre.trim() ? estadoAtencion.asesor_nombre.trim().slice(0, 40) : null
  const toolsTurno = reconocidoServidor ? tools.filter((t) => t.name !== 'solicitar_verificacion') : tools   // ya es cliente: no se le verifica otra vez
  if (cv) {
    // TANDA 1 · 6 · un nombre del catálogo que el cliente escribió él mismo ya no bloquea la respuesta
    for (const n of cv.nombresQueEscribioElCliente(nombresCatalogo, historial.filter((m) => m.actor === 'visitor' || m.actor === 'doctor').map((m) => m.content))) nombresAutorizados.add(n)
  }
  const bloqueFijoConv = cv ? '\n\n' + cv.ESTILO_MENSAJE : ''
  // TANDA 2 · 8 y 9 · quién escribe (enfermería, paciente, revendedor, tercero) y cómo tratarlo, de lo que él mismo dijo
  const textosCliente = historial.filter((m) => m.actor === 'visitor' || m.actor === 'doctor').map((m) => m.content)
  const previoConv = cv ? cv.historialPrevio(historial) : []
  const tipoContacto = t2 && cv!.tipoContacto ? cv!.tipoContacto(textosCliente) : null
  const trato: TratoT | null = t2 && cv!.tratoCliente ? cv!.tratoCliente(textosCliente, null) : null
  const ctxT2 = (): CtxT2 => ({ existencia, adjuntoVisto: !!e.adjunto && canal !== 'portal', hablaronDePago: cv!.hablaronDePago ? cv!.hablaronDePago(previoConv, textoTurno) : true,
    tipo: tipoContacto, trato, envioIncluido: cv!.equipoIncluyoEnvio ? cv!.equipoIncluyoEnvio(previoConv) : false, rafaga: textoTurno,
    canal: canal !== 'portal', resumenPedido: evidencia.some((x) => x === 'CHECKOUT_REVIEW_EVIDENCE' || x === 'PEDIDO_CREADO_EVIDENCE') })
  const bloqueVariableConv = cv && estadoConv ? [cv.textoEstadoConversacion(estadoConv, { rafaga: rafaga.length, verificarDatos: enCanalSinVinculo && !reconocido }),
    reconocido ? cv.textoClienteReconocido({ porServidor: reconocidoServidor, porCliente: estadoConv.dijoCliente, asesor: asesorNombre }) : null,
    tipoContacto && cv.textoTipoContacto ? cv.textoTipoContacto(tipoContacto) : null,
    trato && cv.textoTrato ? cv.textoTrato(trato) : null].filter(Boolean).map((x) => '\n\n' + x).join('') : ''
  const ctxRevision = (): CtxRev | null => estadoConv ? { estado: estadoConv, rafaga: textoTurno, verificarDatos: enCanalSinVinculo, reconocido,
    limite: canal === 'portal' ? null : (evidencia.some((x) => x === 'PEDIDO_CREADO_EVIDENCE' || x === 'CHECKOUT_REVIEW_EVIDENCE' || x === 'CART_MUTATION_EVIDENCE') ? cv!.LIMITE_CANAL_RESUMEN : cv!.LIMITE_CANAL) + (evidencia.includes('PORTAL_LINK_EVIDENCE') ? 120 : 0),
    nombresProducto: [...new Set([...nombresCatalogo, ...nombresAutorizados])] } : null
  const fallar = async (clase: string, ambiguo: boolean, rondas: number): Promise<ResultadoTurno> => {
    await rpc('cc_ia_turno_fallar', { p_turn: turnId, p_error_class: clase, p_desconocido: ambiguo, p_intent: intencion, p_tool_rounds: rondas, p_input_tokens: usage.input, p_output_tokens: usage.output })
    await rpc('cc_ia_aviso_no_disponible', { p_conv: e.conv })   // una vez por conversación (client_id fijo)
    obs('proveedor', clase.startsWith('provider') ? 'provider_error' : 'internal_error', { code: clase })
    return { estado: 'fallo', clase, turnId, intencion, evidencia, rondas, usage }
  }
  const persistir = async (texto: string, rondas: number, motivoValidacion?: string): Promise<ResultadoTurno> => {
    // TANDA 1 · 1 · si mientras se generaba llegó otro mensaje del cliente, se espera a que arranque SU turno (que contesta
    // todo junto) y este cede; la base lo descarta como 'superado'. Si no arranca a tiempo, se publica (nunca sin respuesta).
    if (cv && d.esperaPublicar) {
      const desde = ahora()
      for (let i = 0; i < 60; i++) {
        const hayNuevo = await d.esperaPublicar.hayNuevo(e.conv, e.triggerSeq).catch(() => false)
        const turnoNuevo = hayNuevo ? await d.esperaPublicar.turnoNuevo(e.conv, e.triggerSeq).catch(() => false) : false
        if (cv.decidirPublicar({ hayNuevo, turnoNuevo, esperadoMs: ahora() - desde }) !== 'esperar') break
        await d.esperaPublicar.dormir(1000)
      }
    }
    const pr = await rpc('cc_ia_turno_responder', { p_turn: turnId, p_content: texto, p_intent: intencion, p_evidencia: evidencia, p_tool_rounds: rondas, p_input_tokens: usage.input, p_output_tokens: usage.output })
    const p = (pr.data ?? {}) as { persistido?: boolean; motivo?: string }
    if (pr.error) { obs('persistir', 'internal_error', { code: 'rpc' }); return { estado: 'fallo', clase: 'persistence_error', turnId, intencion, evidencia, rondas, usage, motivoValidacion } }
    // CC-7 · ya no hay "oferta" opcional: el handoff lo dispara el servidor al activarse el carrito.
    return { estado: p.persistido ? 'respondio' : 'descartada', turnId, intencion, evidencia, rondas, usage, clase: p.persistido ? undefined : p.motivo, motivoValidacion, ...(reconocido ? { reconocido } : {}) }
  }

  // TANDA 2 · 8 · audio o video sin texto (no hay transcripción): una línea honesta pidiendo que lo escriba, sin llamar al modelo
  if (t2 && canal !== 'portal' && cv!.medioSinTexto && cv!.textoAudio && estadoConv) {
    const medio = cv!.medioSinTexto(rafaga.length ? rafaga : [e.textoUsuario])
    if (medio) return await persistir(cv!.textoAudio(medio, estadoConv.yaSaludo), 0, 'medio_sin_texto')
  }
  const respaldo = (motivo: string) => d.validacion.respuestaSegura(motivo, { limiteClinico, evidencia, textoLimiteClinico: d.politica.MENSAJE_LIMITE_CLINICO, textoGenerico: d.politica.MENSAJE_SIN_RESPUESTA,
    rafaga: textoTurno, ...(cv ? { reconocido, asesor: asesorNombre } : {}) })
  // 4) Bucle de herramientas acotado.
  let corregido = false   // R4-C7 · una sola corrección por producto no consultado
  let buscadoRespaldo = false   // TANDA 1 · 6 · una búsqueda del servidor antes de caer al texto de respaldo
  let corregidoEstilo = false   // TANDA 1 · 4 · una sola regeneración por forma (largo, preguntas, datos)
  let textoValidoPrevio: string | null = null   // si la regeneración por forma falla, se publica este (recortado)
  let notaCorreccion = ''   // R4-C11 · la corrección va como nota del SISTEMA en la siguiente ronda, nunca como mensaje en la conversación
  for (let ronda = 0; ronda < d.config.maxRondas; ronda++) {
    const restante = d.config.timeoutMs - (ahora() - inicio)
    if (restante < 1500) return textoValidoPrevio !== null ? await persistir(textoValidoPrevio, ronda, 'estilo') : await fallar('provider_timeout', ronda > 0, ronda)
    // CACHÉ (2 nov 2026): lo fijo del turno (políticas, tarea, productos mencionados, perfil) va primero y se guarda en caché;
    // lo que cambia en cada ronda (evidencia, atención humana, corrección) va al final, fuera del caché.
    const base = d.politica.construirSistema({ ctx, intencion, limiteClinico, reglasConocimiento: d.reglasConocimiento, evidencia, canal, contacto: contactoPendiente ? e.contacto : null })
    const marca = d.politica.MARCA_VARIABLE ? base.indexOf(d.politica.MARCA_VARIABLE) : -1
    const fijo = (marca >= 0 ? base.slice(0, marca) : base) + productosMencionados + perfilComercial + bloqueFijoConv
    const variable = (marca >= 0 ? base.slice(marca + d.politica.MARCA_VARIABLE!.length) : '') + bloqueVariableConv + notaCorreccion
    const system = fijo + variable
    const r = await d.proveedor.generar({ system, systemFijo: marca >= 0 ? fijo.length : undefined, messages, tools: toolsTurno, max_tokens: d.config.maxTokens, timeoutMs: restante })
    usage.input += r.usage?.input ?? 0; usage.output += r.usage?.output ?? 0
    usage.cacheRead += r.usage?.cacheRead ?? 0; usage.cacheWrite += r.usage?.cacheWrite ?? 0
    if (r.tipo === 'error') return textoValidoPrevio !== null ? await persistir(textoValidoPrevio, ronda, 'estilo') : await fallar(r.clase, r.ambiguo, ronda)

    if (r.tipo === 'texto') {
      const v = d.validacion.validarRespuesta(r.texto, { evidencia, nombresAutorizados: [...nombresAutorizados], nombresCatalogo, limiteClinico })
      if (v.ok) {
        // TANDA 1 · 4 · forma: sin re-saludo ni promo/horario repetidos (determinista); si queda larga, con varias preguntas o
        // pidiendo datos fuera de lugar, UNA regeneración (con tiempo de sobra); si tampoco, recorte determinista.
        const cr = cv ? ctxRevision() : null
        if (!cv || !cr) return await persistir(v.texto, ronda)
        const rv = cv.revisarRespuesta(v.texto, cr)
        // TANDA 2 · lo que afirma de productos, imágenes, quién escribe y el trato (determinista; sin cifras nuevas)
        const c2 = t2 ? ctxT2() : null
        const r2 = c2 ? cv.revisarTanda2!(rv.texto, c2) : { texto: rv.texto, problemas: [] as readonly string[] }
        if (!rv.problemas.length && !r2.problemas.length) return await persistir(r2.texto, ronda)
        await rpc('cc_ia_herramienta_registrar', { p_turn: turnId, p_round: ronda, p_tool: 'revision_estilo', p_status: 'rechazada', p_product_ids: [], p_detalle: { problemas: [...rv.problemas, ...r2.problemas] } })
        let final = cv.recortar(r2.texto, cr)
        if (c2 && r2.problemas.length && cv.corregirTanda2) final = cv.recortar(cv.corregirTanda2(final, r2.problemas, c2, asesorNombre), cr)
        if (reconocido && cv.datosPedidos(final).size) final = cv.textoReconocidoRespaldo(asesorNombre)
        if (!corregidoEstilo && ronda < d.config.maxRondas - 1 && d.config.timeoutMs - (ahora() - inicio) > 20_000) {
          corregidoEstilo = true; textoValidoPrevio = final
          notaCorreccion = (rv.problemas.length ? cv.notaEstilo(rv.problemas, cr.limite) : '') + (r2.problemas.length && cv.notaTanda2 ? cv.notaTanda2(r2.problemas, existencia) : '')
          continue
        }
        return await persistir(final, ronda, 'estilo')
      }
      if (textoValidoPrevio !== null) return await persistir(textoValidoPrevio, ronda, 'estilo')   // la regeneración salió peor: vale la anterior
      await rpc('cc_ia_herramienta_registrar', { p_turn: turnId, p_round: ronda, p_tool: 'validacion_salida', p_status: 'rechazada', p_product_ids: [], p_detalle: { motivo: v.motivo } })
      obs('validacion', 'rejected', { code: v.motivo })
      // TANDA 1 · 6 · antes de caer al respaldo, el SERVIDOR busca el producto que nombró y se lo da como dato: con el
      // resultado del catálogo vuelve a responder (el nombre queda autorizado solo si la búsqueda lo regresa).
      if (cv && v.motivo === 'producto_no_autorizado' && v.detalle && !buscadoRespaldo && ronda < d.config.maxRondas - 1) {
        buscadoRespaldo = true
        const b = await rpc('cc_buscar_productos', { p_q: String(v.detalle).slice(0, 80), p_limite: 5, p_audiencia: ctx.audiencia })
        if (!b.error && Array.isArray(b.data) && b.data.length) {
          for (const id of d.herramientas.idsDe(b.data)) idsAutorizados.add(id); for (const n of d.herramientas.nombresDe(b.data)) nombresAutorizados.add(n)
          addEv(d.herramientas.evidenciaDe('buscar_productos', b.data))
          await rpc('cc_ia_herramienta_registrar', { p_turn: turnId, p_round: ronda, p_tool: 'buscar_productos', p_status: 'ok', p_product_ids: d.herramientas.idsDe(b.data), p_detalle: { origen: 'respaldo', n: d.herramientas.idsDe(b.data).length } })
          notaCorreccion = `\n\nANTES DE RESPONDER (instrucción interna, no la menciones ni pidas disculpas): consulté «${String(v.detalle)}» en el catálogo por ti; esto regresó:\n` +
            d.politica.envolverDatos('resultado_buscar_productos', d.herramientas.acotarSalida(d.herramientas.salidaEnCajas ? d.herramientas.salidaEnCajas(b.data, mediaCaja) : b.data)) +
            '\nResponde su último mensaje usando solo esto (si no hace falta nombrarlo, no lo nombres), directo y como si fuera tu primera respuesta.'
          continue
        }
      }
      // R4-C7 · canal: nombró un producto del catálogo sin consultarlo → UNA corrección interna (el usuario no ve el intento
      // rechazado): que lo consulte y responda de nuevo. Sin rondas o tras la corrección, el texto seguro de siempre.
      if (canal !== 'portal' && v.motivo === 'producto_no_autorizado' && !corregido && ronda < d.config.maxRondas - 1) {
        corregido = true
        // El intento rechazado NO entra al historial: se vuelve a generar con los mismos mensajes y una nota en el sistema
        // (si se le presentara como mensaje, el modelo le contestaría: "Entendido, corrijo mi respuesta…").
        notaCorreccion = `\n\nANTES DE RESPONDER (instrucción interna, no la menciones ni pidas disculpas): no puedes nombrar «${String(v.detalle ?? 'un producto')}» sin haberlo consultado en este turno. Si ese producto no hace falta para responder su último mensaje, no lo menciones; si sí hace falta, consúltalo primero con buscar_productos. Responde directo al usuario, como si fuera tu primera respuesta.`
        continue
      }
      // EXAMEN (2 nov 2026) · una afirmación sin evidencia ya no tira toda la respuesta: UNA corrección interna explicando qué
      // no puede afirmar (el usuario no ve el intento); si vuelve a fallar, el texto seguro de siempre.
      const nota = CORRECCION[v.motivo]
      if (nota && !corregido && ronda < d.config.maxRondas - 1) {
        corregido = true
        notaCorreccion = `\n\nANTES DE RESPONDER (instrucción interna, no la menciones ni pidas disculpas): tu respuesta anterior se descartó porque ${nota} Vuelve a responder su último mensaje con los datos que ya consultaste (o consulta lo que falte), directo y como si fuera tu primera respuesta.`
        continue
      }
      return await persistir(respaldo(v.motivo), ronda, v.motivo)
    }

    // Herramientas: validar → autorizar → ejecutar → acotar → devolver como DATA.
    messages.push({ role: 'assistant', content: r.bloques })
    const resultados: Bloque[] = []
    for (const ll of r.llamadas) {
      const v0 = d.herramientas.validarLlamada(ll.name, ll.input, { conCuenta, idsAutorizados, canal, contactoPendiente, identificado })
      const v: Validada = v0.ok && reconocidoServidor && v0.nombre === 'solicitar_verificacion' ? { ok: false, motivo: 'no_autorizada' } : v0
      if (!v.ok) {
        await rpc('cc_ia_herramienta_registrar', { p_turn: turnId, p_round: ronda, p_tool: String(ll.name).slice(0, 60), p_status: v.motivo === 'no_autorizada' || v.motivo === 'id_no_autorizado' ? 'no_autorizada' : 'rechazada', p_product_ids: [], p_detalle: { motivo: v.motivo } })
        resultados.push({ type: 'tool_result', tool_use_id: ll.id, content: d.politica.envolverDatos('resultado', JSON.stringify({ error: d.herramientas.RECHAZO[v.motivo] ?? 'rechazada' })) })
        continue
      }
      const vc = d.herramientas.argsAInterno ? d.herramientas.argsAInterno(v.nombre, v.args, mediaCaja) : { ok: true as const, args: v.args }   // CAJAS-MEDIOS · cajas del modelo → medias internas
      if (!vc.ok) { resultados.push({ type: 'tool_result', tool_use_id: ll.id, content: d.politica.envolverDatos('resultado', JSON.stringify({ error: 'Ese producto se vende por pieza completa: usa una cantidad entera.' })) }); continue }
      v.args = vc.args
      const ej0 = await ejecutar(v, e, ctx, rpc, { turnId, ronda, carrito, perfilIA, enlace: d.herramientas.ejecutarEnlacePortal, confirmacion: d.politica.esConfirmacionExplicita?.(e.textoUsuario) ?? false,
        ...(estadoProducto ? { existencia: { estado: estadoProducto, nota: (x: unknown) => cv!.notaExistencia?.(x) ?? null } } : {}) })
      const ej = !ej0.error && d.herramientas.complementar ? { ...ej0, data: d.herramientas.complementar(v.nombre, ej0.data) } : ej0
      const salida = ej.error ? { error: 'Herramienta no disponible en este momento. No inventes el dato.' } : (d.herramientas.salidaEnCajas ? d.herramientas.salidaEnCajas(ej.data, mediaCaja) : ej.data)   // CAJAS-MEDIOS
      if (!ej.error) { for (const id of d.herramientas.idsDe(ej.data)) idsAutorizados.add(id); for (const n of d.herramientas.nombresDe(ej.data)) nombresAutorizados.add(n); addEv(d.herramientas.evidenciaDe(v.nombre, ej.data)) }
      const ev = ej.error ? [] : d.herramientas.evidenciaDe(v.nombre, ej.data)
      await rpc('cc_ia_herramienta_registrar', { p_turn: turnId, p_round: ronda, p_tool: v.nombre, p_status: ej.error ? 'error' : (ev.length ? 'ok' : 'vacia'), p_product_ids: v.ids, p_detalle: ej.error ? { motivo: 'rpc' } : { n: d.herramientas.idsDe(ej.data).length, evidencia: ev } })
      if (ej.error) obs('herramienta', 'internal_error', { code: v.nombre })
      resultados.push({ type: 'tool_result', tool_use_id: ll.id, content: d.politica.envolverDatos('resultado_' + v.nombre, d.herramientas.acotarSalida(salida, d.herramientas.limiteSalida?.(v.nombre))) })
    }
    if (ronda === d.config.maxRondas - 1) resultados.push({ type: 'text', text: 'Ya no hay más herramientas disponibles en este turno. Responde ahora al usuario con lo que tienes.' })
    messages.push({ role: 'user', content: resultados })
  }
  // Rondas agotadas con el modelo aún pidiendo herramientas → respuesta segura (nunca inventada).
  obs('rondas', 'rejected', { code: 'max_rondas' })
  return await persistir(textoValidoPrevio ?? respaldo('rondas'), d.config.maxRondas, 'rondas')
}

async function ejecutar(v: { nombre: string; args: Record<string, unknown> }, e: EntradaTurno, ctx: Ctx, rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: string | null }>, t: { turnId: string; ronda: number; carrito: { id: string | null }; perfilIA: string | null; enlace?: () => { url: string; uso: string }; confirmacion?: boolean
  // TANDA 2 · 3 · existencia de lo que buscó (cc_ia_producto_estado) y la nota de qué puede afirmar
  existencia?: { estado: (q: string, hayResultados: boolean) => Promise<unknown>; nota: (estado: unknown) => string | null } }): Promise<{ data: unknown; error: string | null }> {
  const a = v.args
  // PEDIDO POR WHATSAPP · con el doctor vinculado, el dueño del carrito es SU cuenta (el mismo carrito del portal), sin ligarlo a la
  // conversación del contacto; si no, como siempre.
  const vinculado = (e.canal ?? 'portal') !== 'portal' && !!t.perfilIA
  const dueno = vinculado ? { p_actor_type: 'doctor', p_visitor_hash: null, p_profile: t.perfilIA } : { p_actor_type: e.actor, p_visitor_hash: e.visitorHash, p_profile: e.actor === 'doctor' ? e.profile : null }
  // CC-5 · carrito del dueño ligado a la conversación; operation_id estable = turno + llamada (un reintento no duplica).
  const abrirCarrito = async (): Promise<string | null> => {
    if (t.carrito.id) return t.carrito.id
    const r = await rpc('cc_carrito_abrir', { ...dueno, p_conv: vinculado ? null : e.conv })
    const id = (r.data as { cart_id?: string } | null)?.cart_id ?? null
    if (id) t.carrito.id = id
    return id
  }
  // operation_id ESTABLE ante reintentos del turno: turno + ronda + herramienta + hash de args. Un re-run
  // del mismo turno (tras timeout) que vuelva a pedir la misma mutación cae en el mismo id → la base
  // devuelve el resultado cacheado (nunca X×4). Dos llamadas idénticas en la misma ronda también.
  const op = `${t.turnId}:r${t.ronda}:${v.nombre}:${huella(JSON.stringify(a))}`
  if (['ver_carrito', 'agregar_al_carrito', 'actualizar_carrito', 'quitar_del_carrito', 'vaciar_carrito', 'preparar_checkout'].includes(v.nombre)) {
    const cart = await abrirCarrito(); if (!cart) return { data: null, error: 'carrito' }
    switch (v.nombre) {
      case 'ver_carrito': return rpc('cc_carrito_ver', { p_cart: cart, ...dueno })
      case 'agregar_al_carrito': return rpc('cc_carrito_agregar', { p_cart: cart, p_actor_type: 'ai', p_visitor_hash: dueno.p_visitor_hash, p_profile: dueno.p_profile, p_product: a.product_id, p_qty: a.cantidad, p_op: op })
      case 'actualizar_carrito': return rpc('cc_carrito_actualizar', { p_cart: cart, p_actor_type: 'ai', p_visitor_hash: dueno.p_visitor_hash, p_profile: dueno.p_profile, p_product: a.product_id, p_qty: a.cantidad, p_op: op })
      case 'quitar_del_carrito': return rpc('cc_carrito_quitar', { p_cart: cart, p_actor_type: 'ai', p_visitor_hash: dueno.p_visitor_hash, p_profile: dueno.p_profile, p_product: a.product_id, p_op: op })
      case 'vaciar_carrito': return rpc('cc_carrito_vaciar', { p_cart: cart, p_actor_type: 'ai', p_visitor_hash: dueno.p_visitor_hash, p_profile: dueno.p_profile, p_op: op })
      case 'preparar_checkout': return rpc('cc_carrito_preparar_checkout', { p_cart: cart, ...dueno })   // CC-6 · lectura; confirmar NO es una herramienta
    }
  }
  switch (v.nombre) {
    case 'buscar_productos': {
      const r = await rpc('cc_buscar_productos', { p_q: a.consulta, p_limite: LIMITE_RPC.buscar_productos, p_audiencia: ctx.audiencia })
      // NUNCA DESECHAR (2 nov 2026, caso Éclat de Vie: "no tengo Nabota 200" a una clínica que quería 3): un contacto sin
      // verificar solo ve lo publicado en la landing; si lo que pide existe en el catálogo profesional, se le dice que SÍ se
      // maneja (solo el nombre: sin id, precio ni existencias) para que la IA lo pase con un asesor en vez de negarlo.
      // TANDA 2 · un resultado solo «parecido» (error de dedo) no basta: también se mira el catálogo profesional.
      const filas = Array.isArray(r.data) ? r.data as Array<{ puntaje?: unknown }> : []
      const sinFuerte = t.existencia ? !filas.some((p) => Number(p.puntaje ?? 0) >= 75) : !filas.length
      let out: { data: unknown; error: string | null } = r
      if (!r.error && ctx.audiencia === 'public' && sinFuerte) {
        const pro = await rpc('cc_buscar_productos', { p_q: a.consulta, p_limite: 5, p_audiencia: 'verified' })
        if (!pro.error && Array.isArray(pro.data) && pro.data.length) {
          out = { data: { productos: t.existencia ? filas : [], solo_para_profesionales: (pro.data as Array<{ nombre?: string }>).map((p) => ({ nombre: String(p.nombre ?? '') })).filter((p) => p.nombre),
            nota: 'Sí lo manejamos: es de venta exclusiva para profesionales verificados. Confírmale que lo tenemos y pásalo con un asesor (solicitar_asesor) para su precio y su pedido.' }, error: null }
        }
      }
      // TANDA 2 · 3 · lo que puede afirmar: se surte ahora (sí/no, sin cifras), presentación que no manejamos, alternativas
      if (!out.error && t.existencia) {
        const hay = filas.length > 0 || out.data !== r.data
        const est = await t.existencia.estado(String(a.consulta ?? ''), hay)
        if (est) {
          const base = out.data && typeof out.data === 'object' && !Array.isArray(out.data) ? out.data as Record<string, unknown> : { productos: filas }
          const nota = t.existencia.nota(est)
          out = { data: { ...base, existencia: est, ...(nota ? { nota } : {}) }, error: null }
        }
      }
      return out
    }
    case 'obtener_ficha_producto': return rpc('cc_ficha_producto', { p_product: a.product_id, p_audiencia: ctx.audiencia })
    case 'comparar_productos': return rpc('cc_comparar_productos', { p_ids: a.product_ids, p_audiencia: ctx.audiencia })
    case 'buscar_conocimiento': return rpc('cc_buscar_conocimiento', { p_q: a.consulta, p_limite: LIMITE_RPC.buscar_conocimiento, p_audiencia: ctx.audiencia })
    case 'candidatos_comerciales': return rpc('cc_candidatos_recomendacion', { p_categoria: a.categoria, p_familia: a.familia, p_terminos: a.terminos, p_limite: LIMITE_RPC.candidatos_comerciales, p_audiencia: ctx.audiencia })
    // LIVE C1 · precio/disponibilidad/pedidos con el perfil que la IA tiene AUTORIZADO (null fuera del portal), nunca e.profile directo.
    case 'obtener_precio': return rpc('cc_ia_precio', { p_profile: t.perfilIA, p_product: a.product_id, p_qty: a.cantidad })
    // IA-VENDEDORA · cotización con reglas del pedido y recomendaciones: el servidor decide precio y candidatos (perfil autorizado)
    case 'cotizar': return rpc('cc_ia_cotizar', { p_profile: t.perfilIA, p_lineas: a.lineas })
    case 'recomendar_productos': return rpc('cc_ia_recomendaciones', { p_profile: t.perfilIA, p_product: a.product_id, p_limite: 6 })
    case 'obtener_disponibilidad': return rpc('cc_ia_disponibilidad', { p_profile: t.perfilIA, p_product: a.product_id })
    case 'obtener_estado_pedido': return rpc('cc_ia_estado_pedido', { p_profile: t.perfilIA, p_folio: a.folio })
    case 'enlace_portal': return { data: t.enlace ? t.enlace() : null, error: t.enlace ? null : 'desconocida' }   // puro: sin base, sin tokens
    // CONTACTO CONVERSACIONAL · solo el visitante de ESTA conversación (la base lo verifica); un dato malo vuelve como `campo`.
    // PEDIDO POR WHATSAPP · la base exige que ESTE WhatsApp esté vinculado a ESA cuenta; confirmar exige además su "sí" explícito
    case 'guardar_direccion': return rpc('cc_ia_direccion_guardar', { p_conv: e.conv, p_profile: t.perfilIA, p_d: a })
    case 'revisar_pedido': return rpc('cc_ia_pedido_revisar', { p_conv: e.conv, p_profile: t.perfilIA, p_entrega: a.entrega ?? null, p_horario: a.horario ?? null })
    case 'confirmar_pedido':
      if (!t.confirmacion) return { data: { confirmado: false, motivo: 'FALTA_CONFIRMACION_EXPLICITA', nota: 'Su último mensaje no es un sí claro: dale el resumen y pregúntale si lo confirmas.' }, error: null }
      return rpc('cc_ia_pedido_confirmar', { p_conv: e.conv, p_profile: t.perfilIA })
    // LINK DE PAGO · la base exige el vínculo; regresa folio, monto y estado (nunca la URL: la entrega el sistema)
    case 'pedir_link_pago': return rpc('cc_ia_link_pago', { p_conv: e.conv, p_profile: t.perfilIA, p_folio: a.folio ?? null })
    // VERIFICACIÓN POR WHATSAPP · la solicitud es de ESTA conversación (la base revisa que siga sin identificar)
    case 'solicitar_verificacion': return rpc('cc_ia_solicitar_alta', { p_conv: e.conv, p_nombre: a.nombre, p_cedula: a.cedula, p_email: a.email, p_especialidad: a.especialidad, p_ciudad: a.ciudad })
    case 'registrar_contacto': return rpc('cc_ia_registrar_contacto', { p_conv: e.conv, p_hash: e.visitorHash, p_nombre: a.nombre, p_telefono: a.telefono, p_email: a.email, p_es_medico: a.es_medico, p_cedula: a.cedula })
    case 'solicitar_asesor': {
      // R4-C15 · canal: cuando la IA decide pasar la conversación, el traspaso se registra con el aviso interno (prefijo
      // 'comercial', solo para el equipo) y la IA se lo dice al cliente en SU respuesta; así nunca sale "Pediste hablar con un
      // asesor" a quien no lo pidió. cc_solicitar_asesor queda idempotente y devuelve el estado (modo, asesor) de siempre.
      const canalE = e.canal ?? 'portal'
      if (canalE !== 'portal') await rpc('_cc_canal_transferir', { p_conv: e.conv, p_origen: canalE, p_prefijo: 'comercial', p_motivo: 'ia_transfiere', p_respiro: false })
      return rpc('cc_solicitar_asesor', { p_conv: e.conv, p_actor_type: e.actor, p_visitor_hash: e.visitorHash, p_profile: dueno.p_profile })
    }
    // CC-7 · rechazo del asesor para ESTA compra (no toca la cartera ni impone enfriamiento global).
    case 'declinar_asesor': return rpc('cc_handoff_rechazar', { p_conv: e.conv, p_actor_type: 'ai', p_visitor_hash: dueno.p_visitor_hash, p_profile: dueno.p_profile })
    default: return { data: null, error: 'desconocida' }
  }
}

/** Huella corta y determinista (djb2) para derivar operation_id sin dependencias. */
function huella(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

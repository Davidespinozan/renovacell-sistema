// CC-4 · Orquestador comercial de IA, compartido por el chat (Edge chat) y WhatsApp (Edge meta-webhook). Aquí solo se
// arma el entorno (proveedor, límites, lectura interna de mensajes) y se traduce el resultado; la lógica vive en
// _shared/ia/* (pura, probada). Sin llave del proveedor deja un aviso de sistema una sola vez.
import { ejecutarTurno, type CanalTurno, type EntradaTurno } from './orquestador.ts'
import * as politica from './politica.ts'
import { esLimiteClinico } from './politica.ts'
import * as herramientas from './herramientas.ts'
import * as validacion from './validacion.ts'
import { configurar, crearProveedorAnthropic, esModeloConPensamiento, type OpcionesModelo } from './proveedor.ts'
import { REGLAS_IA } from '../conocimiento.ts'
import { limitar, limitarTodas, tokensEstimados } from '../limite.ts'
import { esNumeroEmpresa, frenoBot, sinContenido } from './antibot.ts'

// R4-B2-IA1 · la política de canal: su propio clasificador (sin falsos positivos de "quiere una persona") y sus mensajes
// seguros. La tarea y el contexto del canal los decide construirSistema por `canal`. El portal usa `politica` tal cual.
const validacionCanalBase = { ...validacion, respuestaSegura: validacion.respuestaSeguraCanal }
const politicaCanalBase = { ...politica, clasificarIntencion: politica.clasificarIntencionCanal, MENSAJE_SIN_RESPUESTA: politica.MENSAJE_SIN_RESPUESTA_CANAL, MENSAJE_LIMITE_CLINICO: politica.MENSAJE_LIMITE_CLINICO_CANAL }

// R4-C9 · datos del negocio desde el ERP (lectura con service_role; mejor esfuerzo: si falla, la IA no los tiene y lo dice).
// deno-lint-ignore no-explicit-any
export async function leerNegocio(admin: any): Promise<politica.DatosNegocio> {
  const q = async (f: () => PromiseLike<{ data: unknown; error: unknown }>) => { try { const x = await f(); return x.error ? null : x.data } catch { return null } }
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date())   // AAAA-MM-DD en Culiacán
  const [empresa, horario, entrega, manual, promos] = await Promise.all([
    q(() => admin.from('company_settings').select('razon_social, direccion, cp, ciudad, estado, telefono, aviso_ia, aviso_ia_hasta').eq('id', 'default').maybeSingle()),
    q(() => admin.from('cc_horario_semanal').select('dia, abierto, abre, cierra').order('dia')),
    q(() => admin.from('entrega_config').select('recoge_lugar, recoge_horario, cp_local_desde, cp_local_hasta, dias_chofer, local_mismo_dia, corte, local_gratis_desde, local_costo, dias_paqueteria, dhl_transito_min, dhl_transito_max, foraneo_costo, foraneo_gratis_desde').eq('id', 1).maybeSingle()),
    // R4-C10 · solo lo APROBADO y para cualquier contacto (el canal es público)
    q(() => admin.from('cc_company_knowledge').select('tema, titulo, contenido').eq('estado', 'approved').eq('audiencia', 'public').order('tema').order('titulo')),
    // R4-C10 · promociones activas y vigentes hoy: nombre, fin y productos (nunca el precio de la línea)
    q(() => admin.from('promociones').select('nombre, hasta, promocion_lineas(products(name))').eq('activa', true).lte('desde', hoy).gte('hasta', hoy).order('hasta')),
  ])
  const promociones = Array.isArray(promos) ? (promos as Array<{ nombre: string; hasta: string | null; promocion_lineas?: Array<{ products?: { name?: string } | null }> | null }>).map((p) => ({
    nombre: p.nombre, hasta: p.hasta, productos: [...new Set((p.promocion_lineas ?? []).map((l) => l.products?.name).filter((x): x is string => !!x))],
  })) : null
  const em = empresa as { aviso_ia?: string | null; aviso_ia_hasta?: string | null } | null
  return { empresa: empresa as politica.DatosNegocio['empresa'], horario: horario as politica.DatosNegocio['horario'], entrega: entrega as politica.DatosNegocio['entrega'],
    manual: Array.isArray(manual) ? manual as politica.DatosNegocio['manual'] : null, promociones,
    aviso: em?.aviso_ia ? { texto: em.aviso_ia, hasta: em.aviso_ia_hasta ?? null } : null, ahora: new Date().toISOString() }
}
/** Política y validación del canal con los datos del negocio de este turno. */
export function dependenciasCanal(n: politica.DatosNegocio, o: { comercial?: boolean } = {}) {
  const texto = politica.textoNegocio(n); const montos = politica.montosEnvio(n)
  const manual = politica.textoManual(n); const promos = politica.textoPromociones(n); const nombresPromo = politica.nombresPromocion(n)
  // AVISO-IA · el aviso vigente y la fecha/hora van PRIMERO: mandan sobre la dirección y el horario.
  const aviso = politica.textoAviso(n); const ahora = politica.textoAhora(n)
  const bloques = [aviso && politica.envolverDatos('aviso_vigente', aviso), ahora && politica.envolverDatos('fecha_y_hora', ahora), texto && politica.envolverDatos('negocio', texto), manual && politica.envolverDatos('manual_de_ventas', manual), promos && politica.envolverDatos('promociones_vigentes', promos)].filter(Boolean)
  return {
    politica: { ...politicaCanalBase, construirSistema: (e: politica.EntradaSistema) => politica.construirSistema(e) + (bloques.length ? '\n\n' + bloques.join('\n\n') : ''),
      // R4-C11 · si la conversación viene de una compra ("2 nabota" → "100"), el turno sigue con la tarea de compra
      clasificarIntencion: (t: string) => { const i = politica.clasificarIntencionCanal(t); return o.comercial && !['CLINICAL_BOUNDARY', 'HUMAN_REQUEST', 'ORDER_STATUS'].includes(i) ? 'CHECKOUT' : i } },
    validacion: { ...validacionCanalBase, validarRespuesta: (t: unknown, c: Parameters<typeof validacion.validarRespuesta>[1]) => {
      if (typeof t !== 'string') return validacion.validarRespuesta(t, c)
      const limpio = validacion.sinFrasesDeSistema(t.replace(/\r\n?/g, '\n').trim())
      // los productos de una promoción vigente vienen del servidor: cuentan como autorizados en este turno
      const v = validacion.validarRespuesta(validacion.sinMontosDeEnvio(limpio, montos), { ...c, nombresAutorizados: [...c.nombresAutorizados, ...nombresPromo] })
      return v.ok ? { ok: true as const, texto: limpio } : v
    } },
  }
}

// ENT-P · el PORTAL recibe los mismos datos del negocio que el canal (entrega, horario, manual aprobado y promociones
// vigentes) y el carrito trae cuánto falta para el envío gratis. Conserva su clasificador, sus mensajes seguros y su
// validación; solo los montos de envío del ERP, dentro de frases de envío, quedan fuera de la regla de precio.
export function dependenciasPortal(n: politica.DatosNegocio) {
  const texto = politica.textoNegocio(n); const montos = politica.montosEnvio(n)
  const manual = politica.textoManual(n); const promos = politica.textoPromociones(n); const nombresPromo = politica.nombresPromocion(n)
  // AVISO-IA · el aviso vigente y la fecha/hora van PRIMERO: mandan sobre la dirección y el horario.
  const aviso = politica.textoAviso(n); const ahora = politica.textoAhora(n)
  const bloques = [aviso && politica.envolverDatos('aviso_vigente', aviso), ahora && politica.envolverDatos('fecha_y_hora', ahora), texto && politica.envolverDatos('negocio', texto), manual && politica.envolverDatos('manual_de_ventas', manual), promos && politica.envolverDatos('promociones_vigentes', promos)].filter(Boolean)
  const extra = (bloques.length ? '\n\n' + bloques.join('\n\n') : '') + (texto ? '\n\n' + politica.REGLA_ENVIO_GRATIS_PORTAL : '')
  return {
    politica: { ...politica, construirSistema: (e: politica.EntradaSistema) => politica.construirSistema(e) + extra },
    herramientas: { ...herramientas, complementar: (nombre: string, salida: unknown) => politica.conEnvioGratis(nombre, salida, n) },
    validacion: { ...validacion, validarRespuesta: (t: unknown, c: Parameters<typeof validacion.validarRespuesta>[1]) => {
      if (typeof t !== 'string') return validacion.validarRespuesta(t, c)
      const v = validacion.validarRespuesta(validacion.sinMontosDeEnvio(t, montos), { ...c, nombresAutorizados: [...c.nombresAutorizados, ...nombresPromo] })
      return v.ok ? { ok: true as const, texto: t.replace(/\r\n?/g, '\n').trim() } : v
    } },
  }
}

// deno-lint-ignore no-explicit-any
type ResultadoIA = 'respondio' | 'no_disponible' | 'silenciada' | 'descartada' | 'en_curso' | 'limitada'
// R4-B2-IA1 · 'transferida' solo existe en canales: el portal conserva exactamente su contrato anterior.
export async function responderIA(admin: any, conv: string, seqUsuario: number, actor: 'visitor' | 'doctor', profile: string | null, visitorHash: string | null, texto: string, sujeto: string, canal?: 'portal', adjunto?: null, contacto?: EntradaTurno['contacto']): Promise<ResultadoIA>
export async function responderIA(admin: any, conv: string, seqUsuario: number, actor: 'visitor' | 'doctor', profile: string | null, visitorHash: string | null, texto: string, sujeto: string, canal: CanalTurno, adjunto?: EntradaTurno['adjunto'] | null): Promise<ResultadoIA | 'transferida'>
export async function responderIA(admin: any, conv: string, seqUsuario: number, actor: 'visitor' | 'doctor', profile: string | null, visitorHash: string | null, texto: string, sujeto: string, canal: CanalTurno = 'portal', adjunto: EntradaTurno['adjunto'] | null = null, contacto: EntradaTurno['contacto'] = null): Promise<ResultadoIA | 'transferida'> {
  // R4-B2-IA1 · en canales (WhatsApp/Instagram/Messenger): una solicitud EXPLÍCITA de persona o un asunto de pedido o
  // reclamación se transfiere de inmediato con la herramienta existente (cc_solicitar_asesor, idempotente), sin llamar al
  // modelo: el cliente recibe UN aviso (el del sistema, con la disponibilidad real) y no una respuesta duplicada de la IA.
  // Si ya había una solicitud en curso, la IA sigue informando con normalidad.
  let comercial: politica.MotivoComercial | null = null
  if (canal !== 'portal') {
    // ANTIBOT · antes de todo (y sin llamar al modelo): mensajes sin contenido o de otro bot no se contestan. Si no se
    // puede leer el historial, sigue el flujo normal (el techo por contacto de canal, abajo, sigue cortando).
    // BOT DETECTADO (6 nov) · un número 800/900 de empresa nunca recibe a la IA (se marca), y una conversación ya marcada
    // como bot en las últimas 24 h tampoco: el bot de hoy cambió de frase y la IA alcanzó a contestarle dos veces.
    if (esNumeroEmpresa(sujeto)) { await admin.rpc('cc_bot_detectado', { p_conv: conv, p_motivo: 'numero_empresa' }).then(() => {}, () => {}); return 'silenciada' }
    const yaBot = await admin.rpc('cc_canal_conversacion', { p_conv: conv }).then((x: { data: unknown }) => !!(x.data as { bot?: unknown } | null)?.bot, () => false)
    if (yaBot) return 'silenciada'
    let hist: Array<{ actor: string; content: string }> = []
    if (!sinContenido(texto)) { try { hist = await leerInterno(admin, conv, seqUsuario, 20) } catch { hist = [] } }
    const freno = frenoBot(hist, texto)
    if (freno) {
      // BOT DETECTADO · se avisa a Renovacell (evento + campana, una vez al día por conversación). Un mensaje sin contenido
      // solo no basta (una persona también manda reacciones o tipos raros); los 800/900 ya se cortaron arriba.
      const motivoBot = freno === 'sin_contenido' ? null : freno
      if (motivoBot) await admin.rpc('cc_bot_detectado', { p_conv: conv, p_motivo: motivoBot }).then(() => {}, () => {})
      return 'silenciada'
    }
    const motivo = politica.transferenciaDeterminista(texto)
    if (motivo) {
      const { data, error } = await admin.rpc('cc_solicitar_asesor', { p_conv: conv, p_actor_type: actor, p_visitor_hash: actor === 'visitor' ? visitorHash : null, p_profile: actor === 'doctor' ? profile : null })
        .then((x: { data: unknown; error: unknown }) => x, () => ({ data: null, error: true }))
      if (!error && (data as { idempotente?: boolean } | null)?.idempotente === false) return 'transferida'
    } else {
      // R4-C13 · si la IA SÍ ve el archivo, no se transfiere solo por haberlo mandado: cuenta lo que dice el pie de foto
      comercial = adjunto ? politica.atencionComercial(texto.replace(/^Envió [^.]*\.\s*/, '').replace(/^«|»$/g, '')) : politica.atencionComercial(texto)
      // R4-C11 · "100" tras "2 nabota": la compra sigue aunque este mensaje solo diga la presentación
      // solo para respuestas cortas que continúan la compra ("100", "la de 200", "2"), nunca para un saludo ni otro tema
      if (!comercial && !esLimiteClinico(texto) && politica.esContinuacionCorta(texto)) {
        const previos = await leerInterno(admin, conv, seqUsuario - 1, 8).catch(() => [])
        comercial = politica.compraEnCurso(previos.filter((m) => m.actor === 'visitor' || m.actor === 'doctor').map((m) => m.content))
      }
    }
  }
  const r = await turnoIA(admin, conv, seqUsuario, actor, profile, visitorHash, texto, sujeto, canal, !!comercial, canal === 'portal' ? null : adjunto, canal === 'portal' ? contacto : null)
  // R4-C7 · compra, recompra o negociación en canal: la IA ya confirmó el producto y pidió lo que falta; ahora una persona
  // del equipo comercial toma la venta. Aviso NEUTRO del servidor (_cc_canal_transferir: disponibilidad real, respiro de
  // 12 h, solo si la conversación sigue con la IA). También si la IA no pudo responder: un comprador nunca queda sin atención.
  // R4-C8 · un solo mensaje armonioso: si la IA respondió (ya dijo que un asesor continúa), el aviso del servidor queda
  // solo para el equipo (prefijo 'comercial': no sale por el canal); si no respondió, el aviso SÍ le llega al cliente.
  // SEÑAL DE INTERÉS → HUMANO, SIEMPRE (2 nov 2026, dueño): si la IA respondió, la conversación SIGUE con la IA (la atiende de
  // punta a punta) y el responsable comercial recibe la señal con alarma; solo si la IA no pudo responder, se transfiere
  // como antes para que ningún comprador quede sin atención.
  if (comercial && canal !== 'portal' && r === 'respondio') {
    await admin.rpc('cc_senal_interes', { p_conv: conv, p_motivo: comercial }).then(() => {}, () => {})
    return r
  }
  if (comercial && canal !== 'portal') {
    const prefijo = r === 'respondio' ? 'comercial' : canal === 'whatsapp' ? 'wa' : canal
    const { data, error } = await admin.rpc('_cc_canal_transferir', { p_conv: conv, p_origen: canal, p_prefijo: prefijo, p_motivo: 'atencion_comercial', p_respiro: true })
      .then((x: { data: unknown; error: unknown }) => x, () => ({ data: null, error: true }))
    if (r !== 'respondio' && !error && data === true) return 'transferida'
  }
  return r
}

// deno-lint-ignore no-explicit-any
async function turnoIA(admin: any, conv: string, seqUsuario: number, actor: 'visitor' | 'doctor', profile: string | null, visitorHash: string | null, texto: string, sujeto: string, canal: CanalTurno, comercial = false, adjunto: EntradaTurno['adjunto'] | null = null, contacto: EntradaTurno['contacto'] = null): Promise<ResultadoIA> {
  const env = (k: string) => Deno.env.get(k)
  const cfg0 = configurar(env)
  // R4-C11 · los canales usan su propio modelo (por defecto Claude Opus 5.5 con esfuerzo bajo); el portal sigue igual
  const mp = cfg0.ok && canal === 'portal' ? await leerModeloPortal(admin) : null
  const cfg = cfg0.ok && canal !== 'portal' ? { ...cfg0, config: configCanal(cfg0.config, env) } : cfg0.ok && mp ? { ...cfg0, config: configPortal(cfg0.config, mp.modelo, env) } : cfg0
  const aviso = async () => { await admin.rpc('cc_ia_aviso_no_disponible', { p_conv: conv }).then(() => {}, () => {}) }
  if (!cfg.ok) { await aviso(); return 'no_disponible' }
  // CC-0B · ráfaga/hora por sujeto y techo global: sin cupo NO se llama al proveedor.
  // ANTIBOT · en canales, además un techo por contacto (30/h, 100/día): una persona real no lo alcanza; un bucle con otro bot sí.
  const canalTecho = canal !== 'portal' ? [{ scope: 'ia_turno_canal_hora', sujeto }, { scope: 'ia_turno_canal_dia', sujeto }] : []
  const v = await limitarTodas(admin, actor === 'doctor'
    ? [{ scope: 'ia_turno_uid', sujeto }, { scope: 'ia_turno_hora', sujeto }, ...canalTecho, { scope: 'ia_turno_global', sujeto: 'global' }]
    : [{ scope: 'ia_turno', sujeto }, { scope: 'ia_turno_hora', sujeto }, ...canalTecho, { scope: 'ia_turno_global', sujeto: 'global' }])
  if (!v.permitido) return 'limitada'
  // Costo diario en tokens: pre-carga estimada (historial acotado + salida) y ajuste con el consumo real.
  const estimado = tokensEstimados([texto], cfg.config.maxTokens) + 1500
  const costo = await limitarTodas(admin, [{ scope: 'ia_tokens_dia', sujeto: 'global', costo: estimado }, ...(actor === 'doctor' ? [{ scope: 'ia_tokens_dia_uid', sujeto, costo: estimado }] : [])])
  if (!costo.permitido) return 'limitada'

  const opciones: OpcionesModelo | undefined = canal === 'portal' ? (mp && esModeloConPensamiento(mp.modelo) ? { effort: mp.esfuerzo, fallbacks: true } : undefined) : { effort: esfuerzoCanal(env), fallbacks: true }
  const proveedor = crearProveedorAnthropic({ key: cfg.key, model: cfg.config.model, fetch: globalThis.fetch.bind(globalThis), opciones })
  const negocio = await leerNegocio(admin)
  const portalDeps = canal === 'portal' ? dependenciasPortal(negocio) : null
  const canalDeps = portalDeps ?? dependenciasCanal(negocio, { comercial })
  const resultado = await ejecutarTurno(
    // LIVE C1 · `canal` manda: fuera del portal el orquestador ignora el perfil (audiencia pública) aunque venga.
    { conv, triggerSeq: seqUsuario, actor, profile: actor === 'doctor' ? profile : null, visitorHash, textoUsuario: texto, canal, ...(adjunto ? { adjunto } : {}), ...(contacto ? { contacto } : {}) },
    {
      rpc: (fn, args) => admin.rpc(fn, args),
      leerMensajes: (c, hasta, limite) => leerInterno(admin, c, hasta, limite),
      proveedor, config: cfg.config, politica: canalDeps.politica, herramientas: portalDeps ? portalDeps.herramientas : herramientas, validacion: canalDeps.validacion, reglasConocimiento: REGLAS_IA,
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

// R4-C11 · configuración del canal: modelo AI_MODEL_CANAL (Claude Opus 5.5 por defecto), más salida (el modelo piensa antes de
// responder) y más tiempo (el aviso "escribiendo…" ya cubre la espera; la Edge responde a Meta antes).
export const MODELO_CANAL = 'claude-opus-5-5'
export function configCanal(base: { model: string; timeoutMs: number; maxTokens: number; maxRondas: number; historial: number; provider: 'anthropic' }, env: (k: string) => string | undefined) {
  const model = (env('AI_MODEL_CANAL') ?? '').trim() || MODELO_CANAL
  const num = (k: string, d: number, min: number, max: number) => { const v = Number(env(k)); return Number.isFinite(v) && v >= min && v <= max ? Math.floor(v) : d }
  return esModeloConPensamiento(model)
    ? { ...base, model, maxTokens: num('AI_MAX_TOKENS_CANAL', 8000, 1000, 32000), timeoutMs: num('AI_TIMEOUT_MS_CANAL', 45_000, 5_000, 120_000) }
    : { ...base, model }
}
// IA MEJOR QUE EL HUMANO · B (2 nov 2026): el modelo del PORTAL lo elige Dirección en cc_ia_config (lista cerrada, la
// misma que usa el examen); vacío = AI_MODEL / Haiku de siempre. Un modelo 5.x piensa antes de responder: más salida y
// más tiempo, igual que el canal.
export function configPortal(base: { model: string; timeoutMs: number; maxTokens: number; maxRondas: number; historial: number; provider: 'anthropic' }, modelo: string, env: (k: string) => string | undefined) {
  const num = (k: string, d: number, min: number, max: number) => { const v = Number(env(k)); return Number.isFinite(v) && v >= min && v <= max ? Math.floor(v) : d }
  return esModeloConPensamiento(modelo)
    ? { ...base, model: modelo, maxTokens: num('AI_MAX_TOKENS_PORTAL', 8000, 1000, 32000), timeoutMs: num('AI_TIMEOUT_MS_PORTAL', 45_000, 5_000, 120_000) }
    : { ...base, model: modelo }
}
// deno-lint-ignore no-explicit-any
export async function leerModeloPortal(admin: any): Promise<{ modelo: string; esfuerzo: 'low' | 'medium' | 'high' } | null> {
  try {
    const { data, error } = await admin.from('cc_ia_config').select('modelo_portal, esfuerzo_portal').eq('id', true).maybeSingle()
    if (error || !data?.modelo_portal) return null
    return { modelo: String(data.modelo_portal), esfuerzo: ['medium', 'high'].includes(data.esfuerzo_portal) ? data.esfuerzo_portal : 'low' }
  } catch { return null }   // sin la tabla o sin lectura: el portal sigue con el modelo de siempre
}
export function esfuerzoCanal(env: (k: string) => string | undefined): 'low' | 'medium' | 'high' {
  const e = (env('AI_EFFORT_CANAL') ?? '').trim().toLowerCase()
  return e === 'medium' || e === 'high' ? e : 'low'
}

// Lectura interna con service_role (el orquestador corre en el servidor, no es un cliente).
// Chat V2-C1 · la base acota el contexto a la SESIÓN del disparador (nunca el transcript eterno).
// deno-lint-ignore no-explicit-any
async function leerInterno(admin: any, conv: string, hastaSeq: number, limite: number): Promise<Array<{ actor: string; content: string }>> {
  const { data, error } = await admin.rpc('cc_ia_contexto', { p_conv: conv, p_hasta_seq: hastaSeq, p_limite: limite })
  if (error) throw new Error('contexto_ia')
  return ((data ?? []) as Array<{ actor: string; content: string }>).map((m) => ({ actor: m.actor, content: m.content }))
}


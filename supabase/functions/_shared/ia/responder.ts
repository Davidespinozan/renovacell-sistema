// CC-4 · Orquestador comercial de IA, compartido por el chat (Edge chat) y WhatsApp (Edge meta-webhook). Aquí solo se
// arma el entorno (proveedor, límites, lectura interna de mensajes) y se traduce el resultado; la lógica vive en
// _shared/ia/* (pura, probada). Sin llave del proveedor deja un aviso de sistema una sola vez.
import { ejecutarTurno, type CanalTurno } from './orquestador.ts'
import * as politica from './politica.ts'
import * as herramientas from './herramientas.ts'
import * as validacion from './validacion.ts'
import { configurar, crearProveedorAnthropic } from './proveedor.ts'
import { REGLAS_IA } from '../conocimiento.ts'
import { limitar, limitarTodas, tokensEstimados } from '../limite.ts'

// R4-B2-IA1 · la política de canal: su propio clasificador (sin falsos positivos de "quiere una persona") y sus mensajes
// seguros. La tarea y el contexto del canal los decide construirSistema por `canal`. El portal usa `politica` tal cual.
const validacionCanalBase = { ...validacion, respuestaSegura: validacion.respuestaSeguraCanal }
const politicaCanalBase = { ...politica, clasificarIntencion: politica.clasificarIntencionCanal, MENSAJE_SIN_RESPUESTA: politica.MENSAJE_SIN_RESPUESTA_CANAL, MENSAJE_LIMITE_CLINICO: politica.MENSAJE_LIMITE_CLINICO_CANAL }

// R4-C9 · datos del negocio desde el ERP (lectura con service_role; mejor esfuerzo: si falla, la IA no los tiene y lo dice).
// deno-lint-ignore no-explicit-any
export async function leerNegocio(admin: any): Promise<politica.DatosNegocio> {
  const q = async (f: () => PromiseLike<{ data: unknown; error: unknown }>) => { try { const x = await f(); return x.error ? null : x.data } catch { return null } }
  const [empresa, horario, entrega] = await Promise.all([
    q(() => admin.from('company_settings').select('razon_social, direccion, cp, ciudad, estado, telefono').eq('id', 'default').maybeSingle()),
    q(() => admin.from('cc_horario_semanal').select('dia, abierto, abre, cierra').order('dia')),
    q(() => admin.from('entrega_config').select('recoge_lugar, recoge_horario, cp_local_desde, cp_local_hasta, dias_chofer, local_mismo_dia, corte, local_gratis_desde, local_costo, dias_paqueteria, dhl_transito_min, dhl_transito_max, foraneo_costo, foraneo_gratis_desde').eq('id', 1).maybeSingle()),
  ])
  return { empresa: empresa as politica.DatosNegocio['empresa'], horario: horario as politica.DatosNegocio['horario'], entrega: entrega as politica.DatosNegocio['entrega'] }
}
/** Política y validación del canal con los datos del negocio de este turno. */
export function dependenciasCanal(n: politica.DatosNegocio) {
  const texto = politica.textoNegocio(n); const montos = politica.montosEnvio(n)
  return {
    politica: { ...politicaCanalBase, construirSistema: (e: politica.EntradaSistema) => politica.construirSistema(e) + (texto ? '\n\n' + politica.envolverDatos('negocio', texto) : '') },
    validacion: { ...validacionCanalBase, validarRespuesta: (t: unknown, c: Parameters<typeof validacion.validarRespuesta>[1]) => {
      if (typeof t !== 'string') return validacion.validarRespuesta(t, c)
      const v = validacion.validarRespuesta(validacion.sinMontosDeEnvio(t, montos), c)
      return v.ok ? { ok: true as const, texto: t.replace(/\r\n?/g, '\n').trim() } : v
    } },
  }
}

// deno-lint-ignore no-explicit-any
type ResultadoIA = 'respondio' | 'no_disponible' | 'silenciada' | 'descartada' | 'en_curso' | 'limitada'
// R4-B2-IA1 · 'transferida' solo existe en canales: el portal conserva exactamente su contrato anterior.
export async function responderIA(admin: any, conv: string, seqUsuario: number, actor: 'visitor' | 'doctor', profile: string | null, visitorHash: string | null, texto: string, sujeto: string, canal?: 'portal'): Promise<ResultadoIA>
export async function responderIA(admin: any, conv: string, seqUsuario: number, actor: 'visitor' | 'doctor', profile: string | null, visitorHash: string | null, texto: string, sujeto: string, canal: CanalTurno): Promise<ResultadoIA | 'transferida'>
export async function responderIA(admin: any, conv: string, seqUsuario: number, actor: 'visitor' | 'doctor', profile: string | null, visitorHash: string | null, texto: string, sujeto: string, canal: CanalTurno = 'portal'): Promise<ResultadoIA | 'transferida'> {
  // R4-B2-IA1 · en canales (WhatsApp/Instagram/Messenger): una solicitud EXPLÍCITA de persona o un asunto de pedido o
  // reclamación se transfiere de inmediato con la herramienta existente (cc_solicitar_asesor, idempotente), sin llamar al
  // modelo: el cliente recibe UN aviso (el del sistema, con la disponibilidad real) y no una respuesta duplicada de la IA.
  // Si ya había una solicitud en curso, la IA sigue informando con normalidad.
  let comercial: politica.MotivoComercial | null = null
  if (canal !== 'portal') {
    const motivo = politica.transferenciaDeterminista(texto)
    if (motivo) {
      const { data, error } = await admin.rpc('cc_solicitar_asesor', { p_conv: conv, p_actor_type: actor, p_visitor_hash: actor === 'visitor' ? visitorHash : null, p_profile: actor === 'doctor' ? profile : null })
        .then((x: { data: unknown; error: unknown }) => x, () => ({ data: null, error: true }))
      if (!error && (data as { idempotente?: boolean } | null)?.idempotente === false) return 'transferida'
    } else comercial = politica.atencionComercial(texto)
  }
  const r = await turnoIA(admin, conv, seqUsuario, actor, profile, visitorHash, texto, sujeto, canal)
  // R4-C7 · compra, recompra o negociación en canal: la IA ya confirmó el producto y pidió lo que falta; ahora una persona
  // del equipo comercial toma la venta. Aviso NEUTRO del servidor (_cc_canal_transferir: disponibilidad real, respiro de
  // 12 h, solo si la conversación sigue con la IA). También si la IA no pudo responder: un comprador nunca queda sin atención.
  // R4-C8 · un solo mensaje armonioso: si la IA respondió (ya dijo que un asesor continúa), el aviso del servidor queda
  // solo para el equipo (prefijo 'comercial': no sale por el canal); si no respondió, el aviso SÍ le llega al cliente.
  if (comercial && canal !== 'portal') {
    const prefijo = r === 'respondio' ? 'comercial' : canal === 'whatsapp' ? 'wa' : canal
    const { data, error } = await admin.rpc('_cc_canal_transferir', { p_conv: conv, p_origen: canal, p_prefijo: prefijo, p_motivo: 'atencion_comercial', p_respiro: true })
      .then((x: { data: unknown; error: unknown }) => x, () => ({ data: null, error: true }))
    if (r !== 'respondio' && !error && data === true) return 'transferida'
  }
  return r
}

// deno-lint-ignore no-explicit-any
async function turnoIA(admin: any, conv: string, seqUsuario: number, actor: 'visitor' | 'doctor', profile: string | null, visitorHash: string | null, texto: string, sujeto: string, canal: CanalTurno): Promise<ResultadoIA> {
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
  const canalDeps = canal === 'portal' ? null : dependenciasCanal(await leerNegocio(admin))
  const resultado = await ejecutarTurno(
    // LIVE C1 · `canal` manda: fuera del portal el orquestador ignora el perfil (audiencia pública) aunque venga.
    { conv, triggerSeq: seqUsuario, actor, profile: actor === 'doctor' ? profile : null, visitorHash, textoUsuario: texto, canal },
    {
      rpc: (fn, args) => admin.rpc(fn, args),
      leerMensajes: (c, hasta, limite) => leerInterno(admin, c, hasta, limite),
      proveedor, config: cfg.config, politica: canalDeps ? canalDeps.politica : politica, herramientas, validacion: canalDeps ? canalDeps.validacion : validacion, reglasConocimiento: REGLAS_IA,
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


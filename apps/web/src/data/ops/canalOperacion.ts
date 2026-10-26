// R4-B2-4 · Cliente del PANEL OPERATIVO de canales (Dirección): controles del canal (B2-1), revisión y decisiones sobre la
// cola de salida (B2-2), toma formal de una conversación (B2-3b) y las lecturas del panel (B2-4). Todo es RPC: la base
// valida Dirección (activa), la compuerta de activación, la ventana de 24 h y la exclusividad. Aquí solo se presenta lo que
// el servidor devuelve; ningún botón habilitado aquí salta una regla del servidor.
// Los nombres aún no están en database.types.ts (se regeneran al aplicar las migraciones 20270118…22).
import { captureError } from '../../lib/sentry'
import { sanitizarTexto } from '../../lib/sanitizar'
import { hasSupabase, supabase } from '../../lib/supabase'
import { ERROR_GENERICO, referenciaError, type Reportar, type Resultado } from './atencion'

export type CanalOp = 'whatsapp' | 'instagram' | 'messenger'
export const NOMBRE_CANAL_OP: Record<CanalOp, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Facebook' }
export interface ControlCanal { canal: CanalOp; modo: 'espejo' | 'activo'; ia_habilitada: boolean; envio_pausado: boolean; updated_at: string | null }
export interface CambioHistorial { canal: CanalOp; antes: Partial<ControlCanal> | null; despues: Partial<ControlCanal> | null; origen: string | null; actor: string | null; motivo: string | null; at: string }
export interface EstadoCanales { activacion_disponible: boolean; canales: ControlCanal[]; historial: CambioHistorial[] }
export type CambiosCanal = Partial<Pick<ControlCanal, 'modo' | 'ia_habilitada' | 'envio_pausado'>>
export interface SalidaPorDecidir { id: string; estado: 'retenido' | 'incierto'; conversation_id: string; creado: string; texto: string; error: string | null; resultado: Record<string, unknown> | null; contacto?: string; ventana_abierta: boolean | null }
export interface RevisionSalidas { canal: CanalOp; envio_habilitado: boolean; conteos: Record<string, number>; por_decidir: SalidaPorDecidir[] }
export type ResultadoDecision = 'liberado' | 'descartado' | 'estado_invalido' | 'fuera_de_ventana' | 'otro_canal' | 'no_encontrado'
export interface Decision { lote: string; canal: CanalOp; accion: 'liberar' | 'descartar'; aplicados: number; total: number; resultados: Array<{ id: string; resultado: ResultadoDecision }> }
export type Atiende = 'ia' | 'direccion' | 'vendedor' | 'nadie'
export interface ControlConversacion {
  canal: CanalOp | null; canal_modo?: 'espejo' | 'activo'; ia_habilitada?: boolean; envio_pausado?: boolean; modo?: string; estado?: string
  atiende?: Atiende; atiende_nombre?: string | null; soy_yo?: boolean; tomada_at?: string | null
  puede_tomar?: boolean; motivo_no_tomar?: string | null; puede_escribir?: boolean; motivo_no_escribir?: string | null
}
export interface AtencionHumana { conversation_id: string; modo: string; atiende: 'direccion' | 'vendedor' | null; atiende_nombre: string | null; soy_yo: boolean; desde: string | null }
export interface Descartado { id: string; conversation_id: string; texto: string; decidido_at: string | null; decidido_por: string | null; motivo: string | null }
export interface PanelCanal { canal: CanalOp; atencion_humana: AtencionHumana[]; descartados: Descartado[] }
export interface Toma { modo: 'human_active'; tomada_por: string; desde?: string; idempotente: boolean }

export const MAX_SELECCION = 100   // límite del servidor (cc_salida_decidir: de 1 a 100)
export const MOTIVO_MIN = 5        // mínimo del servidor (cc_canal_cambiar / cc_salida_decidir)

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

export function mensajeErrorCanal(m: string | undefined): string {
  const t = m ?? ''
  if (/CUENTA_SUSPENDIDA/.test(t)) return 'Tu acceso fue suspendido por Dirección.'
  if (/NO_AUTORIZADO|permission denied/.test(t)) return 'Solo Dirección opera los canales.'
  if (/ACTIVACION_BLOQUEADA/.test(t)) return 'La activación sigue bloqueada en el servidor: falta completar y autorizar la puesta en marcha.'
  if (/IA_REQUIERE_ACTIVO/.test(t)) return 'La IA solo se enciende con el canal activo.'
  if (/MOTIVO_REQUERIDO/.test(t)) return `Escribe el motivo (mínimo ${MOTIVO_MIN} caracteres).`
  if (/MOTIVO_LARGO/.test(t)) return 'El motivo es demasiado largo (máximo 500 caracteres).'
  if (/CANAL_NO_HABILITADO/.test(t)) return 'No se libera nada con el canal en espejo o con los envíos pausados.'
  if (/SELECCION_INVALIDA/.test(t)) return `Elige de 1 a ${MAX_SELECCION} mensajes.`
  if (/ATENDIDA_POR_OTRO/.test(t)) return 'Otra persona ya atiende esta conversación.'
  if (/TOMA_REQUERIDA/.test(t)) return 'Toma la conversación antes de responder.'
  if (/CANAL_EN_ESPEJO/.test(t)) return 'El canal está en modo espejo: no se envían respuestas.'
  if (/CONVERSACION_CERRADA/.test(t)) return 'La conversación ya está cerrada.'
  if (/NO_ES_CANAL/.test(t)) return 'La toma aplica solo a conversaciones de WhatsApp, Instagram o Facebook.'
  if (/CANAL_INVALIDO|CAMBIO_INVALIDO|ACCION_INVALIDA/.test(t)) return 'La operación no es válida.'
  return ERROR_GENERICO
}

export class ClienteCanalOperacion {
  constructor(private rpc: Rpc = rpcPorDefecto, private reportar: Reportar = captureError) {}
  private async llamar<T>(fn: string, args?: Record<string, unknown>): Promise<Resultado<T>> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, error: 'La operación de canales requiere conexión con el servidor.' }
    try {
      const { data, error } = await this.rpc(fn, args)
      if (error) {
        const texto = mensajeErrorCanal(error.message)
        if (texto !== ERROR_GENERICO) return { ok: false, error: texto }
        const ref = referenciaError()
        try { this.reportar(new Error(`canal:${fn} · ${sanitizarTexto(error.message ?? '').texto}`), { pantalla: 'canales', clasificacion: 'rpc_no_reconocido', code: ref }) } catch { /* la telemetría nunca rompe la app */ }
        return { ok: false, error: `${ERROR_GENERICO} Si se repite, comparte la referencia ${ref} con soporte.` }
      }
      return { ok: true, data: data as T }
    } catch { return { ok: false, error: 'No hay conexión con el servidor. Intenta de nuevo.' } }
  }
  estado() { return this.llamar<EstadoCanales>('cc_canal_estado') }
  cambiar(canal: CanalOp, cambios: CambiosCanal, motivo: string) { return this.llamar<{ cambiado: boolean }>('cc_canal_cambiar', { p_canal: canal, p_cambios: cambios, p_motivo: motivo }) }
  revision(canal: CanalOp, limite = 50) { return this.llamar<RevisionSalidas>('cc_salida_revision', { p_canal: canal, p_limite: limite }) }
  decidir(canal: CanalOp, ids: string[], accion: 'liberar' | 'descartar', motivo: string) { return this.llamar<Decision>('cc_salida_decidir', { p_canal: canal, p_ids: ids, p_accion: accion, p_motivo: motivo }) }
  panel(canal: CanalOp) { return this.llamar<PanelCanal>('cc_canal_panel', { p_canal: canal }) }
  control(conversationId: string) { return this.llamar<ControlConversacion>('cc_canal_conversacion_control', { p_conv: conversationId }) }
  tomar(conversationId: string, motivo?: string | null) { return this.llamar<Toma>('cc_tomar_conversacion', { p_conv: conversationId, p_motivo: motivo?.trim() || null }) }
}
export const canalOperacion = new ClienteCanalOperacion()

// ── Presentación (pura) ──────────────────────────────────────────────────────────────────────────────
export const ETIQUETA_RESULTADO: Record<ResultadoDecision, string> = {
  liberado: 'Liberado: vuelve a la cola de envío', descartado: 'Descartado: no se enviará', estado_invalido: 'Sin cambio: su estado ya no lo permite',
  fuera_de_ventana: 'Sin cambio: fuera de la ventana de 24 h', otro_canal: 'Sin cambio: es de otro canal', no_encontrado: 'Sin cambio: ya no existe',
}
export const MOTIVO_NO_ESCRIBIR: Record<string, string> = {
  toma_requerida: 'Toma la conversación para responder. Mientras tanto la lees sin intervenir.',
  atendida_por_otro: 'Otra persona atiende esta conversación: solo lectura.',
  canal_en_espejo: 'Canal en modo espejo: aquí solo se lee.',
  conversacion_cerrada: 'La conversación está cerrada.',
}
export const MOTIVO_NO_TOMAR: Record<string, string> = {
  atendida_por_otro: 'Ya la atiende otra persona.', canal_en_espejo: 'Con el canal en espejo no se toman conversaciones.',
  conversacion_cerrada: 'La conversación está cerrada.', ya_es_tuya: 'Ya la atiendes tú.',
}
export function textoAtiende(c: Pick<ControlConversacion, 'atiende' | 'atiende_nombre' | 'soy_yo'>): string {
  switch (c.atiende) {
    case 'ia': return 'Atiende el asistente (IA)'
    case 'direccion': return c.soy_yo ? 'La atiendes tú (Dirección)' : `La atiende ${c.atiende_nombre ?? 'Dirección'} (Dirección)`
    case 'vendedor': return c.soy_yo ? 'La atiendes tú' : `La atiende ${c.atiende_nombre ?? 'una vendedora'}`
    default: return 'Nadie la atiende desde aquí'
  }
}

/** Qué controles ofrece la pantalla. Solo refleja al servidor: activar o encender la IA exige la compuerta abierta. */
export function accionesCanal(c: ControlCanal, activacionDisponible: boolean) {
  const bloqueo = activacionDisponible ? null : 'La activación está bloqueada en el servidor hasta completar y autorizar la puesta en marcha.'
  return {
    activar: { visible: c.modo === 'espejo', habilitada: activacionDisponible, porque: bloqueo },
    espejo: { visible: c.modo === 'activo', habilitada: true, porque: null },   // volver a espejo siempre se puede (apaga la IA)
    encenderIA: { visible: !c.ia_habilitada, habilitada: activacionDisponible && c.modo === 'activo', porque: bloqueo ?? (c.modo !== 'activo' ? 'La IA solo se enciende con el canal activo.' : null) },
    apagarIA: { visible: c.ia_habilitada, habilitada: true, porque: null },
    pausar: { visible: !c.envio_pausado, habilitada: true, porque: null },
    reanudar: { visible: c.envio_pausado, habilitada: true, porque: null },   // reanudar NO libera lo retenido (lo decide Dirección)
  }
}

/** Lectura rápida para Dirección: ¿atiende la IA?, ¿salen los mensajes?, ¿hay algo por revisar o bloqueado? */
export function resumenOperativo(c: ControlCanal, activacionDisponible: boolean, rev: RevisionSalidas | null, panel: PanelCanal | null) {
  const retenidos = rev?.conteos?.retenido ?? 0
  const inciertos = rev?.conteos?.incierto ?? 0
  const humanas = panel?.atencion_humana.filter((h) => h.atiende).length ?? 0
  const esperando = panel?.atencion_humana.filter((h) => !h.atiende).length ?? 0
  const lineas: Array<{ tono: 'ok' | 'warn' | 'dang' | 'neu'; texto: string; testid: string }> = []
  lineas.push(c.modo === 'activo'
    ? (c.ia_habilitada ? { tono: 'ok', texto: 'El asistente (IA) atiende primero', testid: 'res-ia' } : { tono: 'warn', texto: 'Canal activo sin IA: los mensajes pasan a una persona', testid: 'res-ia' })
    : { tono: 'neu', texto: 'Modo espejo: se registra y se lee, no se responde desde aquí', testid: 'res-ia' })
  lineas.push(c.envio_pausado ? { tono: 'dang', texto: 'Envíos PAUSADOS: nada sale; lo nuevo queda retenido', testid: 'res-envio' }
    : c.modo !== 'activo' ? { tono: 'neu', texto: 'Sin envíos (espejo)', testid: 'res-envio' } : { tono: 'ok', texto: 'Envíos habilitados', testid: 'res-envio' })
  if (retenidos || inciertos) lineas.push({ tono: inciertos ? 'dang' : 'warn', texto: `${retenidos} retenido(s) y ${inciertos} incierto(s) por revisar`, testid: 'res-revision' })
  if (humanas || esperando) lineas.push({ tono: esperando ? 'warn' : 'neu', texto: `${humanas} atendida(s) por personas${esperando ? ` · ${esperando} esperando asesor` : ''}`, testid: 'res-humanas' })
  if (!activacionDisponible) lineas.push({ tono: 'neu', texto: 'Compuerta de activación cerrada', testid: 'res-compuerta' })
  return lineas
}

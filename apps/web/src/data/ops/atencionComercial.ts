// CHV2-B · Lectura canónica de la ATENCIÓN COMERCIAL para todas las superficies (Inicio, Mi bandeja,
// Conversaciones, Atención comercial, alerta en vivo, campana). Una sola fuente de verdad:
//   · `atencion` = estado derivado por el SERVIDOR (_cc_atencion, CHV2-A) adjunto a cada fila de
//     `cc_cola_asesorias` (vendedor: solo lo suyo, por RLS/auth) y de `cc_ruteo_pendientes` (Dirección).
//   · Las esperas, minutos hábiles, umbrales y si la IA sigue los calcula la base. Aquí NO hay reloj:
//     ni Date.now(), ni temporizadores, ni horario recalculado en el navegador. Solo se presenta.
//   · Un aviso (notifications) es una SEÑAL: antes de alertar se vuelve a leer la cola/pendientes y se
//     comprueba que la solicitud siga accionable (un aviso viejo no revive trabajo resuelto).
import type { ColaItem, ModoConversacion } from './chat'
import type { PendienteRuteo } from './atencion'

export type EstadoAtencion =
  | 'ia' | 'rechazado' | 'solicitado_sin_vendedor' | 'horario_sin_configurar' | 'escalado' | 'aviso'
  | 'fuera_de_horario' | 'asignado_esperando' | 'activo' | 'terminado' | 'cerrada'

/** Espejo de `_cc_atencion(conv)` (migración 123). */
export interface Atencion {
  estado: EstadoAtencion; modo: ModoConversacion; handoff_estado: string | null; handler_id: string | null; ruteo_motivo: string | null
  solicitado_at: string | null; handler_asignado_at: string | null; iniciado_at: string | null; terminado_at: string | null
  espera_total_min: number | null; espera_total_habil_min: number | null; espera_handler_min: number | null; espera_handler_habil_min: number | null
  reloj_sla_min: number | null; horario_configurado: boolean; en_horario: boolean | null; pausa_fuera_horario: boolean
  umbral_aviso_min: number; umbral_escalamiento_min: number; ia_activa: boolean
}

/** Tipos de aviso comercial que emite CHV2-A. */
export const KINDS_COMERCIALES: ReadonlySet<string> = new Set(['handoff_asignado', 'handoff_aviso', 'handoff_escalado', 'handoff_sin_vendedor'])
export const KINDS_VENDEDOR: ReadonlySet<string> = new Set(['handoff_asignado', 'handoff_aviso'])
export const KINDS_DIRECCION: ReadonlySet<string> = new Set(['handoff_escalado', 'handoff_sin_vendedor'])

/** Estados en los que el vendedor asignado todavía no inicia (la solicitud le espera). */
export const ESPERANDO_VENDEDOR: ReadonlySet<EstadoAtencion> = new Set(['asignado_esperando', 'aviso', 'escalado', 'fuera_de_horario', 'horario_sin_configurar'])

export const ETIQUETA_ATENCION: Record<EstadoAtencion, string> = {
  ia: 'Atiende el asistente',
  rechazado: 'Prefirió seguir con el asistente',
  solicitado_sin_vendedor: 'Sin vendedor asignado',
  horario_sin_configurar: 'Esperando asesor',
  escalado: 'Espera prolongada · escalada a Dirección',
  aviso: 'Esperando asesor · recordatorio enviado',
  fuera_de_horario: 'Fuera de horario',
  asignado_esperando: 'Esperando asesor',
  activo: 'Asesoría en curso',
  terminado: 'Asesoría terminada',
  cerrada: 'Cerrada',
}

export type TonoAtencion = 'dang' | 'warn' | 'neu' | 'ok'
export function tonoAtencion(e: EstadoAtencion | null | undefined): TonoAtencion {
  if (e === 'escalado' || e === 'solicitado_sin_vendedor') return 'dang'
  if (e === 'aviso' || e === 'asignado_esperando' || e === 'horario_sin_configurar') return 'warn'
  if (e === 'activo') return 'ok'
  return 'neu'
}
const PRIORIDAD: Partial<Record<EstadoAtencion, number>> = { escalado: 0, solicitado_sin_vendedor: 0, aviso: 1, asignado_esperando: 2, horario_sin_configurar: 2, fuera_de_horario: 3, activo: 4 }
const prioridad = (e: EstadoAtencion | undefined) => (e && PRIORIDAD[e] != null ? PRIORIDAD[e]! : 9)

/** Minutos (del servidor) en texto corto. */
export function formatoMinutos(min: number): string {
  if (min < 60) return `${Math.max(0, Math.floor(min))} min`
  if (min < 60 * 24) return `${Math.floor(min / 60)} h`
  return `${Math.floor(min / (60 * 24))} d`
}

export const TEXTO_HORARIO_PENDIENTE = 'Horario comercial pendiente de configurar'

/**
 * Espera del handler ACTUAL, tal como la da el servidor. Sin horario configurado (y con pausa fuera de
 * horario) el SLA no se puede calcular: se dice eso, nunca "lleva 7 min de retraso".
 */
export function textoEspera(a: Atencion | null | undefined): string | null {
  if (!a || a.estado === 'activo' || a.estado === 'terminado' || a.estado === 'cerrada' || a.estado === 'ia' || a.estado === 'rechazado') return null
  if (a.pausa_fuera_horario && !a.horario_configurado) return TEXTO_HORARIO_PENDIENTE
  if (a.horario_configurado && a.en_horario === false) return 'Fuera de horario · la espera está en pausa'
  if (a.reloj_sla_min == null) return null
  return `${formatoMinutos(a.reloj_sla_min)}${a.pausa_fuera_horario ? ' hábiles' : ''} esperando`
}

/** Antigüedad real de la solicitud (minutos del servidor; no es SLA). */
export function textoSolicitud(edadMin: number | null | undefined): string | null {
  return edadMin == null ? null : `Solicitó hace ${formatoMinutos(edadMin)}`
}

/** Continuidad de la IA según la autoridad (`_cc_ia_puede`): nunca "IA activa" con un humano en curso. */
export function textoIA(a: Atencion | null | undefined, modo: ModoConversacion): string | null {
  if (modo === 'human_active' || a?.estado === 'activo') return null
  const ia = a ? a.ia_activa : modo === 'human_requested' || modo === 'human_assigned'
  if (!ia) return null
  return modo === 'human_requested' || modo === 'human_assigned' ? 'IA atendiendo mientras espera asesor' : 'Atiende el asistente'
}

export const estadoDe = (c: { atencion?: Atencion | null; modo: string }): EstadoAtencion | undefined =>
  c.atencion?.estado ?? (c.modo === 'human_active' ? 'activo' : undefined)

const porPrioridad = <T extends { atencion?: Atencion | null; modo: string; edad_min?: number | null }>(a: T, b: T) =>
  prioridad(estadoDe(a)) - prioridad(estadoDe(b)) || (b.edad_min ?? 0) - (a.edad_min ?? 0)

// ── Vendedor (fuente: cc_cola_asesorias, ya acotada por el servidor a lo suyo) ─────────────────────────
/** Solicitudes que el vendedor debe atender: suyas y todavía sin iniciar. */
export function solicitudesVendedor(cola: ColaItem[]): ColaItem[] {
  return cola.filter((c) => c.es_mia && c.modo === 'human_assigned').sort(porPrioridad)
}
/** Asesorías que el vendedor ya inició. */
export function activasVendedor(cola: ColaItem[]): ColaItem[] {
  return cola.filter((c) => c.es_mia && c.modo === 'human_active')
}

// ── Dirección (fuente: cc_ruteo_pendientes, solo Dirección) ───────────────────────────────────────────
/** Lo que requiere a Dirección: solicitudes sin vendedor y las escaladas por espera. */
export function intervencionDireccion(conversaciones: PendienteRuteo[]): PendienteRuteo[] {
  return conversaciones.filter((c) => (c.modo === 'human_requested' && !c.seller_id) || c.atencion?.estado === 'escalado').sort(porPrioridad)
}

// ── Alerta en vivo: ¿la señal sigue siendo trabajo pendiente según el servidor? ───────────────────────
export type AlertaVendedor = { tipo: 'vendedor'; kind: string; item: ColaItem }
export type AlertaDireccion = { tipo: 'direccion'; kind: string; item: PendienteRuteo }
export type AlertaAccionable = AlertaVendedor | AlertaDireccion

export function alertaAccionable(kind: string | undefined, conversationId: string | undefined, fuente: { tipo: 'vendedor'; cola: ColaItem[] } | { tipo: 'direccion'; conversaciones: PendienteRuteo[] }): AlertaAccionable | null {
  if (!kind || !conversationId || !KINDS_COMERCIALES.has(kind)) return null
  if (fuente.tipo === 'vendedor') {
    if (!KINDS_VENDEDOR.has(kind)) return null
    const item = solicitudesVendedor(fuente.cola).find((c) => c.conversation_id === conversationId)
    return item ? { tipo: 'vendedor', kind, item } : null
  }
  if (!KINDS_DIRECCION.has(kind)) return null
  const item = intervencionDireccion(fuente.conversaciones).find((c) => c.conversation_id === conversationId)
  return item ? { tipo: 'direccion', kind, item } : null
}

// ── Líneas de contexto seguras para tarjetas (Inicio, alerta, consola) ────────────────────────────────
type FilaComercial = { modo: string; atencion?: Atencion | null; n_items?: number | null; edad_min?: number | null; fuera_horario?: boolean | null }
export function lineasSolicitud(c: FilaComercial): string[] {
  const out: string[] = []
  if (c.n_items) out.push(`${c.n_items} producto${c.n_items === 1 ? '' : 's'} en su carrito`)
  const ia = textoIA(c.atencion, c.modo as ModoConversacion); if (ia) out.push(ia)
  const espera = textoEspera(c.atencion); if (espera) out.push(espera)
  const edad = textoSolicitud(c.edad_min); if (edad) out.push(edad)
  if (c.fuera_horario) out.push('Llegó fuera de horario')
  return out
}

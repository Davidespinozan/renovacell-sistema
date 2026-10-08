// CC-7 · Cliente de ATENCIÓN COMERCIAL para Dirección: horario de atención, vendedores elegibles,
// cartera cliente→vendedor y pendientes de ruteo. Todo es RPC: la base valida que sea Dirección,
// audita cada cambio y decide el ruteo. El cliente nunca escribe tablas ni elige por el servidor.
// Los nombres aún no están en database.types.ts (se regeneran al aplicar la migración 119).
import { captureError } from '../../lib/sentry'
import { sanitizarTexto } from '../../lib/sanitizar'
import { hasSupabase, supabase } from '../../lib/supabase'
import type { Atencion } from './atencionComercial'

export interface DiaHorario { dia: number; abierto: boolean; abre: string | null; cierra: string | null }
export interface Excepcion { fecha: string; tipo: 'cerrado' | 'horario'; abre: string | null; cierra: string | null; motivo: string | null }
export interface EstadoHorario { configurado: boolean; abierto: boolean; zona: string; motivo: string; excepcion_hoy?: boolean; proxima_apertura?: string | null; hora_local?: string }
export interface Horario { zona: string; configurado: boolean; actualizado_at: string; semana: DiaHorario[]; excepciones: Excepcion[]; estado: EstadoHorario }
export interface Vendedor { id: string; nombre: string; activo: boolean; conversaciones: boolean; nuevos_clientes: boolean; elegible: boolean; elegible_nuevos: boolean; clientes: number }
export interface ClienteCartera {
  profile_id: string; nombre: string; verificado: boolean; activo: boolean; vendedor_id: string | null; vendedor_nombre: string | null
  vendedor_elegible: boolean; requiere_reasignacion: boolean; asignado_at: string | null; vendedor_historico: string | null
}
export interface ResumenRuteo { horario: EstadoHorario; sin_vendedor: number; reasignacion: number; handoffs_sin_asignar: number; handoffs_pendientes: number; vendedores_elegibles: number }
export interface PendienteRuteo {
  conversation_id: string; dueno: 'doctor' | 'visitante'; profile_id: string | null; nombre: string; modo: string; seller_id: string | null; seller_nombre: string | null
  ruteo_motivo: 'sin_vendedor' | 'vendedor_no_elegible' | 'visitante' | null; origen: 'carrito' | 'manual' | null; fuera_horario: boolean | null
  solicitado_at: string | null; edad_min: number | null; iniciada: boolean; cart_id: string | null; n_items: number
  atencion?: Atencion | null   // CHV2-A · estado derivado del servidor
}
// CHV2-A · umbrales del SLA comercial (minutos hábiles) — Dirección.
export interface ConfigAtencion { aviso_min: number; escalamiento_min: number; pausar_fuera_horario: boolean; updated_at: string | null; horario: EstadoHorario }
export interface ResultadoReasignacion { cartera_vendedor: string | null; [k: string]: unknown }
export interface Pendientes { resumen: ResumenRuteo; conversaciones: PendienteRuteo[]; carritos_pendientes: Array<{ cart_id: string; profile_id: string | null; visitante: boolean; desde: string | null; error: string | null; n_items: number }> }
export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const   // ISO 1..7
export const MOTIVO_RUTEO: Record<string, string> = { sin_vendedor: 'Cliente sin vendedor', vendedor_no_elegible: 'Su vendedor ya no puede atender', visitante: 'Visitante (aún sin cuenta)' }

// HORARIO-P1 · un error que no reconocemos NO se muestra crudo (puede traer detalles internos): el usuario ve el
// genérico + una referencia corta, y el error real (sanitizado) se reporta a observabilidad con esa referencia.
export const ERROR_GENERICO = 'No se pudo completar. Intenta de nuevo.'
export function referenciaError(): string {
  let r = ''
  try { r = crypto.getRandomValues(new Uint32Array(1))[0].toString(36) } catch { r = Math.random().toString(36).slice(2) }
  return 'ATN-' + r.slice(0, 6).toUpperCase().padStart(6, '0')
}
export type Reportar = (error: unknown, contexto: Record<string, unknown>) => void

export function mensajeError(m: string | undefined): string {
  const t = m ?? ''
  if (/NO_AUTORIZADO|permission denied/.test(t)) return 'Solo Dirección administra la atención comercial.'
  if (/ZONA_INVALIDA/.test(t)) return 'La zona horaria no es válida.'
  if (/SEMANA_INVALIDA/.test(t)) return 'Revisa los siete días del horario.'
  if (/HORARIO_INVALIDO/.test(t)) return 'La hora de apertura debe ser antes de la de cierre.'
  if (/EXCEPCION_INVALIDA/.test(t)) return 'Revisa la fecha y el tipo de la excepción.'
  if (/VENDEDOR_NO_ELEGIBLE: activo, de ventas y con/.test(t)) return 'Ese vendedor no puede atender conversaciones: debe estar activo, ser de Ventas y tener "Atender conversaciones" en Equipo.'   // CHV2-A · solicitud
  if (/VENDEDOR_NO_ELEGIBLE/.test(t)) return 'Ese vendedor no puede recibir clientes nuevos: debe estar activo, ser de Ventas y tener "Atender conversaciones" y "Recibir clientes nuevos" en Equipo.'
  if (/MOTIVO_REQUERIDO/.test(t)) return 'Para reasignar o quitar un vendedor escribe el motivo.'
  if (/CLIENTE_INVALIDO/.test(t)) return 'Solo los doctores tienen cartera.'
  // CHV2-A · reasignar SOLO esta solicitud (handler) y umbrales de alerta.
  if (/VENDEDOR_REQUERIDO/.test(t)) return 'Elige a quién pasa la solicitud.'
  if (/SOLICITUD_NO_REASIGNABLE/.test(t)) return 'La asesoría ya está en curso: termínala antes de pasarla a otra persona.'
  if (/SOLICITUD_INEXISTENTE/.test(t)) return 'Esa solicitud ya no existe.'
  if (/CONVERSACION_CERRADA/.test(t)) return 'La conversación ya está cerrada.'
  if (/CONFIG_INVALIDA/.test(t)) return 'Revisa los minutos: el escalamiento debe ser mayor que el aviso (0 a 1440).'
  return ERROR_GENERICO
}

export class ClienteAtencion {
  constructor(private rpc: Rpc = rpcPorDefecto, private reportar: Reportar = captureError) {}
  private async llamar<T>(fn: string, args?: Record<string, unknown>): Promise<Resultado<T>> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, error: 'La atención comercial requiere conexión con el servidor.' }
    try {
      const { data, error } = await this.rpc(fn, args)
      if (error) {
        const texto = mensajeError(error.message)
        if (texto !== ERROR_GENERICO) return { ok: false, error: texto }
        const ref = referenciaError()
        try { this.reportar(new Error(`atencion:${fn} · ${sanitizarTexto(error.message ?? '').texto}`), { pantalla: 'atencion', clasificacion: 'rpc_no_reconocido', code: ref }) } catch { /* la telemetría nunca rompe la app */ }
        return { ok: false, error: `${ERROR_GENERICO} Si se repite, comparte la referencia ${ref} con soporte.` }
      }
      return { ok: true, data: data as T }
    } catch { return { ok: false, error: 'No hay conexión con el servidor. Intenta de nuevo.' } }
  }
  horario() { return this.llamar<Horario>('cc_horario_ver') }
  guardarHorario(zona: string, semana: DiaHorario[]) { return this.llamar<Horario>('cc_horario_guardar', { p_zona: zona, p_semana: semana }) }
  guardarExcepcion(e: { fecha: string; tipo: 'cerrado' | 'horario'; abre?: string | null; cierra?: string | null; motivo?: string | null }) {
    return this.llamar<Horario>('cc_horario_excepcion_guardar', { p_fecha: e.fecha, p_tipo: e.tipo, p_abre: e.abre ?? null, p_cierra: e.cierra ?? null, p_motivo: e.motivo ?? null })
  }
  borrarExcepcion(fecha: string) { return this.llamar<Horario>('cc_horario_excepcion_borrar', { p_fecha: fecha }) }
  vendedores() { return this.llamar<Vendedor[]>('cc_vendedores') }
  cartera(filtro: 'todos' | 'sin_vendedor' | 'reasignacion' = 'todos') { return this.llamar<ClienteCartera[]>('cc_cartera_listar', { p_filtro: filtro }) }
  asignar(cliente: string, vendedor: string | null, motivo?: string | null) { return this.llamar<{ idempotente: boolean }>('cc_cartera_asignar', { p_cliente: cliente, p_vendedor: vendedor, p_motivo: motivo ?? null }) }
  resumen() { return this.llamar<ResumenRuteo>('cc_ruteo_resumen') }
  pendientes() { return this.llamar<Pendientes>('cc_ruteo_pendientes') }
  // CHV2-A · pasa SOLO esta solicitud a otro vendedor (handler). La cartera NO cambia; motivo obligatorio.
  reasignarSolicitud(conversation_id: string, vendedor: string, motivo: string) {
    return this.llamar<ResultadoReasignacion>('cc_solicitud_reasignar', { p_conv: conversation_id, p_vendedor: vendedor, p_motivo: motivo })
  }
  configAtencion() { return this.llamar<ConfigAtencion>('cc_atencion_config_ver') }
  guardarConfigAtencion(aviso: number, escalamiento: number, pausar: boolean) {
    return this.llamar<ConfigAtencion>('cc_atencion_config_guardar', { p_aviso: aviso, p_escalamiento: escalamiento, p_pausar: pausar })
  }
}
export const atencion = new ClienteAtencion()

/** Valida el horario semanal antes de enviarlo (el servidor vuelve a validar). */
export function validarSemana(semana: DiaHorario[]): string | null {
  if (semana.length !== 7) return 'Faltan días.'
  for (const d of semana) {
    if (!d.abierto) continue
    if (!d.abre || !d.cierra) return `${DIAS[d.dia - 1]}: indica apertura y cierre.`
    if (d.abre >= d.cierra) return `${DIAS[d.dia - 1]}: la apertura debe ser antes del cierre.`
  }
  return null
}

/** Texto para la cabecera: estado actual según el servidor. */
export function textoEstadoHorario(e: EstadoHorario | null | undefined): string {
  if (!e || !e.configurado) return 'Horario de atención SIN CONFIGURAR: el sistema no promete atención inmediata.'
  if (e.abierto) return 'En horario de atención.'
  return e.proxima_apertura ? `Fuera de horario · abre ${new Date(e.proxima_apertura).toLocaleString('es-MX', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.` : 'Fuera de horario.'
}

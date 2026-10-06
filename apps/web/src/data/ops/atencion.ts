// CC-7 · Cliente de ATENCIÓN COMERCIAL para Dirección: horario de atención, vendedores elegibles,
// cartera cliente→vendedor y pendientes de ruteo. Todo es RPC: la base valida que sea Dirección,
// audita cada cambio y decide el ruteo. El cliente nunca escribe tablas ni elige por el servidor.
// Los nombres aún no están en database.types.ts (se regeneran al aplicar la migración 119).
import { hasSupabase, supabase } from '../../lib/supabase'

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
}
export interface Pendientes { resumen: ResumenRuteo; conversaciones: PendienteRuteo[]; carritos_pendientes: Array<{ cart_id: string; profile_id: string | null; visitante: boolean; desde: string | null; error: string | null; n_items: number }> }
export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const   // ISO 1..7
export const MOTIVO_RUTEO: Record<string, string> = { sin_vendedor: 'Cliente sin vendedor', vendedor_no_elegible: 'Su vendedor ya no puede atender', visitante: 'Visitante (aún sin cuenta)' }

export function mensajeError(m: string | undefined): string {
  const t = m ?? ''
  if (/NO_AUTORIZADO|permission denied/.test(t)) return 'Solo Dirección administra la atención comercial.'
  if (/ZONA_INVALIDA/.test(t)) return 'La zona horaria no es válida.'
  if (/SEMANA_INVALIDA/.test(t)) return 'Revisa los siete días del horario.'
  if (/HORARIO_INVALIDO/.test(t)) return 'La hora de apertura debe ser antes de la de cierre.'
  if (/EXCEPCION_INVALIDA/.test(t)) return 'Revisa la fecha y el tipo de la excepción.'
  if (/VENDEDOR_NO_ELEGIBLE/.test(t)) return 'Ese vendedor no puede recibir clientes nuevos: debe estar activo, ser de Ventas y tener "Atender conversaciones" y "Recibir clientes nuevos" en Equipo.'
  if (/MOTIVO_REQUERIDO/.test(t)) return 'Para reasignar o quitar un vendedor escribe el motivo.'
  if (/CLIENTE_INVALIDO/.test(t)) return 'Solo los doctores tienen cartera.'
  return 'No se pudo completar. Intenta de nuevo.'
}

export class ClienteAtencion {
  constructor(private rpc: Rpc = rpcPorDefecto) {}
  private async llamar<T>(fn: string, args?: Record<string, unknown>): Promise<Resultado<T>> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, error: 'La atención comercial requiere conexión con el servidor.' }
    try {
      const { data, error } = await this.rpc(fn, args)
      if (error) return { ok: false, error: mensajeError(error.message) }
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

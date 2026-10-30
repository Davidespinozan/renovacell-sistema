// HERRAMIENTAS DEL VENDEDOR · bloque C (mig 20270216): en qué quedó la plática con un cliente y cuándo retomarla. Uno vigente
// por cliente y vendedor; la alerta llega el día que toca. La autoridad está en la base.
import { hasSupabase, supabase } from '../../lib/supabase'
import { hoyNegocio, sumarDias } from '../periodo'

export type EstadoSeguimiento = 'cotizacion_enviada' | 'esperando_pago' | 'lo_esta_pensando' | 'quedo_de_llamar' | 'volver_a_ofrecer' | 'esperando_datos' | 'otro'
export const ESTADOS_SEGUIMIENTO: Array<{ clave: EstadoSeguimiento; etiqueta: string }> = [
  { clave: 'cotizacion_enviada', etiqueta: 'Le mandé cotización' }, { clave: 'esperando_pago', etiqueta: 'Esperando su pago' },
  { clave: 'lo_esta_pensando', etiqueta: 'Lo está pensando' }, { clave: 'quedo_de_llamar', etiqueta: 'Quedó de llamarme' },
  { clave: 'volver_a_ofrecer', etiqueta: 'Volver a ofrecerle' }, { clave: 'esperando_datos', etiqueta: 'Esperando sus datos' },
  { clave: 'otro', etiqueta: 'Otro' },
]
export const ETIQUETA_ESTADO = Object.fromEntries(ESTADOS_SEGUIMIENTO.map((e) => [e.clave, e.etiqueta])) as Record<EstadoSeguimiento, string>
export const PLAZOS: Array<{ dias: number; etiqueta: string }> = [{ dias: 1, etiqueta: 'Mañana' }, { dias: 3, etiqueta: 'En 3 días' }, { dias: 7, etiqueta: 'En 1 semana' }, { dias: 14, etiqueta: 'En 2 semanas' }, { dias: 30, etiqueta: 'En 1 mes' }]
export const enDias = (n: number) => sumarDias(hoyNegocio(), n)

export interface Seguimiento {
  id: string; customer_id: string | null; conversation_id: string | null; estado: EstadoSeguimiento; nota: string | null
  recordar_el: string; hecho: boolean; creado: string; vendedor: string | null; es_mio: boolean; nombre: string | null; conversacion: string | null
}
export type Res<T> = { ok: true; data: T } | { ok: false; mensaje: string }

/** "hoy", "mañana", "vencido hace 2 días", "el 4 nov". */
export function cuandoRetomar(fecha: string, hoy = hoyNegocio()): { texto: string; tono: 'dang' | 'warn' | 'neu' } {
  const d = Math.round((Date.parse(fecha + 'T12:00:00Z') - Date.parse(hoy + 'T12:00:00Z')) / 86_400_000)
  if (d < 0) return { texto: `vencido hace ${-d} ${d === -1 ? 'día' : 'días'}`, tono: 'dang' }
  if (d === 0) return { texto: 'retomar hoy', tono: 'warn' }
  if (d === 1) return { texto: 'retomar mañana', tono: 'neu' }
  return { texto: `retomar el ${new Date(fecha + 'T12:00:00Z').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`, tono: 'neu' }
}

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>
const mensaje = (m?: string) => /NO_AUTORIZADO/.test(m ?? '') ? 'No puedes dejar seguimiento a este cliente.' : /fecha/.test(m ?? '') ? 'Elige una fecha de hoy en adelante.' : 'No se pudo guardar. Intenta de nuevo.'

export class ClienteSeguimientos {
  constructor(private rpc: Rpc = rpcPorDefecto) {}
  private async llamar<T>(fn: string, args?: Record<string, unknown>): Promise<Res<T>> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
    try { const { data, error } = await this.rpc(fn, args); return error ? { ok: false, mensaje: mensaje(error.message) } : { ok: true, data: data as T } } catch { return { ok: false, mensaje: 'No hay conexión con el servidor.' } }
  }
  guardar(d: { customer: string | null; conv: string | null; estado: EstadoSeguimiento; nota: string; recordar: string }) {
    return this.llamar<Seguimiento>('seguimiento_guardar', { p_customer: d.customer, p_conv: d.conv, p_estado: d.estado, p_nota: d.nota || null, p_recordar: d.recordar })
  }
  hecho(id: string) { return this.llamar<Seguimiento>('seguimiento_actualizar', { p_id: id, p_hecho: true, p_recordar: null }) }
  posponer(id: string, recordar: string) { return this.llamar<Seguimiento>('seguimiento_actualizar', { p_id: id, p_hecho: false, p_recordar: recordar }) }
  de(customer: string | null, conv: string | null) { return this.llamar<Seguimiento | null>('seguimiento_de', { p_customer: customer, p_conv: conv }) }
  mios() { return this.llamar<{ hoy: string; seguimientos: Seguimiento[] }>('mis_seguimientos') }
}
export const seguimientos = new ClienteSeguimientos()

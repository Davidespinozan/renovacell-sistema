// VINCULAR-CLIENTE (mig 20270206) · expediente del cliente dentro de la conversación. El personal confirma QUIÉN escribe
// (WhatsApp, Instagram/Messenger, enlace) y desde ahí trabaja su ficha. La autoridad es del servidor: Dirección o el asesor
// asignado; vincular a un cliente de otro vendedor no da su expediente (la conversación pasa a su vendedor).
import { hasSupabase, supabase } from '../../lib/supabase'

export type MotivoSugerencia = 'telefono' | 'correo' | 'nombre'
export interface SugerenciaCliente {
  customer_id: string; nombre: string; motivo: MotivoSugerencia; telefono: string | null; ciudad: string | null
  tiene_cuenta: boolean; tu_cartera: boolean; vendedor: string | null
}
export interface FichaConversacion {
  vinculado: boolean; con_cuenta: boolean
  traspasada?: boolean            // solo en el navegador: se vinculó y pasó a su vendedor (quien vinculó ya no la trabaja)
  customer_id?: string; por?: 'personal' | 'cuenta'; nombre?: string; ciudad?: string | null; activo?: boolean; tiene_cuenta?: boolean
  vendedor?: string | null; vendedor_nombre?: string | null; es_tuyo?: boolean
  // Solo para Dirección o su vendedor:
  email?: string | null; telefono?: string | null; pedidos?: number
  ultimo_pedido?: { folio: string | null; fecha: string; total: number; estado: string } | null
  invitacion_vigente?: boolean
}
export interface ResultadoVinculo { customer_id: string; idempotente: boolean; numero_guardado?: boolean; cartera_asignada?: boolean; reasignada?: boolean; vendedor?: string | null; vendedor_nombre?: string | null }
export type Res<T> = { ok: true; data: T } | { ok: false; mensaje: string }

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, args as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export function mensajeExpediente(t: string | undefined): string {
  const m = t ?? ''
  if (/NO_AUTORIZADO/.test(m)) return 'Esta conversación ya no es tuya: la atiende otra persona.'
  if (/CONVERSACION_CON_CUENTA/.test(m)) return 'Esta persona ya tiene cuenta: su ficha se liga sola.'
  if (/CONVERSACION_CERRADA/.test(m)) return 'La conversación ya está cerrada.'
  if (/CLIENTE_INACTIVO/.test(m)) return 'Ese cliente está dado de baja: reactívalo antes de vincularlo.'
  if (/CLIENTE_INEXISTENTE/.test(m)) return 'Ese cliente ya no existe.'
  return 'No se pudo completar. Intenta de nuevo.'
}

export class ClienteExpediente {
  constructor(private rpc: Rpc = rpcPorDefecto) {}
  private async llamar<T>(fn: string, args: Record<string, unknown>): Promise<Res<T>> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
    try {
      const { data, error } = await this.rpc(fn, args)
      if (error) return { ok: false, mensaje: mensajeExpediente(error.message) }
      return { ok: true, data: data as T }
    } catch { return { ok: false, mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } }
  }
  ficha(conv: string) { return this.llamar<FichaConversacion>('cc_cliente_de_conversacion', { p_conv: conv }) }
  sugerencias(conv: string) { return this.llamar<SugerenciaCliente[]>('cc_cliente_sugerencias', { p_conv: conv }) }
  vincular(conv: string, customer: string, guardarNumero = true) { return this.llamar<ResultadoVinculo>('cc_vincular_cliente', { p_conv: conv, p_customer: customer, p_guardar_numero: guardarNumero }) }
  desvincular(conv: string) { return this.llamar<{ idempotente: boolean }>('cc_desvincular_cliente', { p_conv: conv }) }
}
export const expediente = new ClienteExpediente()

export const ETIQUETA_MOTIVO: Record<MotivoSugerencia, string> = { telefono: 'Mismo teléfono', correo: 'Mismo correo', nombre: 'Por el nombre que escribió' }

/** Texto para el vendedor tras vincular: qué pasó con la conversación. */
export function textoVinculo(r: ResultadoVinculo, nombre: string): string {
  if (r.idempotente) return `Ya estaba vinculada con ${nombre}.`
  const partes = [`Vinculada con ${nombre}.`]
  if (r.numero_guardado) partes.push('Su número quedó en la ficha: la próxima vez se reconoce sola.')
  if (r.cartera_asignada) partes.push('No tenía vendedor: ahora está en tu cartera.')
  if (r.reasignada && r.vendedor_nombre) partes.push(`La conversación pasó a ${r.vendedor_nombre}, su vendedor.`)
  return partes.join(' ')
}

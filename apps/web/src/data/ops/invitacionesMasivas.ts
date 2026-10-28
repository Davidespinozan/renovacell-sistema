// INVITA-1 · cliente de las INVITACIONES MASIVAS (solo Dirección). Todo es RPC: la base arma la audiencia, decide a
// quién no (y por qué), respeta horario y límite diario y emite cada invitación. La pantalla solo pide y muestra.
import { hasSupabase, supabase } from '../../lib/supabase'
import type { EstadoHorario } from './atencion'

export type CanalInvitacion = 'correo' | 'whatsapp'
export type EstadoCampana = 'activa' | 'pausada' | 'terminada' | 'cancelada'
export interface Previa { canal: CanalInvitacion; elegibles: number; omitidos: Record<string, number>; total: number }
export interface Campana {
  id: string; canal: CanalInvitacion; estado: EstadoCampana; nota: string | null; limite_diario: number; plantilla_wa: string | null
  creada_at: string; sin_vendedor: boolean; vendedor: string | null
  pendientes: number; enviados: number; inciertos: number; fallidos: number; omitidos: number; cancelados: number; hoy: number; cuentas: number
}
export interface EstadoMasivas { horario: EstadoHorario; campanas: Campana[] }
export interface RenglonRevision { customer_id: string; nombre: string; destino: string | null; estado: string; motivo: string | null }
export interface FiltroAudiencia { seller: string | null; sinVendedor: boolean }
export type Res<T> = { ok: true; data: T } | { ok: false; error: string }

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, args as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export const MOTIVO_OMITIDO: Record<string, string> = {
  invitacion_vigente: 'Ya tiene una invitación vigente',
  sin_correo: 'Sin correo', correo_invalido: 'Correo mal escrito', correo_repetido: 'Correo repetido en otro cliente',
  correo_con_cuenta: 'Ese correo ya tiene cuenta', sin_telefono: 'Sin celular de 10 dígitos', telefono_repetido: 'Celular repetido en otro cliente',
  ya_tiene_cuenta: 'Ya creó su cuenta', dado_de_baja: 'Dado de baja',
}
export const ESTADO_CAMPANA: Record<EstadoCampana, string> = { activa: 'Enviando', pausada: 'En pausa', terminada: 'Terminada', cancelada: 'Cancelada' }

export function mensajeError(t: string | undefined): string {
  const m = t ?? ''
  if (/CAMPANA_VIVA/.test(m)) return 'Ya hay una campaña de este canal en curso: termínala o cancélala primero.'
  if (/FALTA_PLANTILLA/.test(m)) return 'Escribe el nombre de la plantilla de WhatsApp aprobada por Meta.'
  if (/SIN_DESTINATARIOS/.test(m)) return 'Nadie de este filtro puede recibir la invitación por este canal.'
  if (/ACCION_INVALIDA/.test(m)) return 'La campaña cambió de estado; actualiza la pantalla.'
  if (/NO_AUTORIZADO|permission denied/.test(m)) return 'Solo Dirección puede enviar invitaciones masivas.'
  return 'No se pudo completar. Intenta de nuevo.'
}

export class ClienteInvitacionesMasivas {
  constructor(private rpc: Rpc = rpcPorDefecto) {}
  private async llamar<T>(fn: string, args?: Record<string, unknown>): Promise<Res<T>> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, error: 'Requiere conexión con el servidor.' }
    try {
      const { data, error } = await this.rpc(fn, args)
      return error ? { ok: false, error: mensajeError(error.message) } : { ok: true, data: data as T }
    } catch { return { ok: false, error: 'No hay conexión con el servidor. Intenta de nuevo.' } }
  }
  estado() { return this.llamar<EstadoMasivas>('invitaciones_masivas_estado') }
  previa(canal: CanalInvitacion, f: FiltroAudiencia) { return this.llamar<Previa>('invitaciones_masivas_previa', { p_canal: canal, p_seller: f.seller, p_sin_vendedor: f.sinVendedor }) }
  crear(canal: CanalInvitacion, f: FiltroAudiencia, limiteDiario: number, plantilla: string | null) {
    return this.llamar<{ campana_id: string; pendientes: number; omitidos: number }>('invitaciones_masivas_crear',
      { p_canal: canal, p_seller: f.seller, p_sin_vendedor: f.sinVendedor, p_limite_diario: limiteDiario, p_plantilla: plantilla, p_idioma: 'es_MX' })
  }
  cambiar(id: string, accion: 'pausar' | 'reanudar' | 'cancelar') { return this.llamar<{ estado: EstadoCampana }>('invitaciones_masivas_cambiar', { p_campana: id, p_accion: accion }) }
  revisar(id: string) { return this.llamar<RenglonRevision[]>('invitaciones_masivas_revisar', { p_campana: id }) }
}
export const invitacionesMasivas = new ClienteInvitacionesMasivas()

/** Días que tardará una campaña al ritmo elegido (solo días hábiles con envío). */
export const diasEstimados = (pendientes: number, limiteDiario: number): number => (limiteDiario > 0 ? Math.ceil(pendientes / limiteDiario) : 0)

/** Texto de la plantilla de WhatsApp que se manda a Meta para aprobación ({{1}} nombre, {{2}} enlace). */
export const TEXTO_PLANTILLA_WA = 'Hola {{1}}, te escribimos de Renovacell. Como ya eres cliente, te abrimos tu cuenta en nuestro nuevo portal: ahí verás precios, harás pedidos y hablarás con tu asesora. Tu cuenta ya está verificada; solo crea tu contraseña aquí: {{2}} (el enlace vence en 14 días).'

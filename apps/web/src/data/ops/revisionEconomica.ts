// PAY-EXP-01A-3 · Cliente de la REVISIÓN ECONÓMICA (lectura canónica revision_economica, PAY-EXP-01A-2). Solo
// Dirección/Facturación; la autorización la decide el servidor (auth_role) — aquí no se recalcula nada: montos,
// incidencias y estado del caso vienen tal cual de la RPC.
import { hasSupabase, supabase } from '../../lib/supabase'

export type Incidencia = 'declaracion_abierta_en_cancelado' | 'dinero_sin_reembolso_autorizado' | 'reembolso_autorizado_pendiente' | 'cancelacion_sin_evidencia'
export interface CasoRevision {
  order_id: string; folio: string | null; estado_pedido: string; estado_caso: 'abierto' | 'resuelto'
  incidencia_principal: Incidencia; incidencias: Incidencia[]
  cliente: { customer_id: string | null; doctor_id: string | null; nombre: string | null }
  montos: { total: number; cobrado_neto: number; reembolso_pendiente: number; sin_reembolso_autorizado: number; saldo: number; estado_pago: string }
  cancelacion: { fecha: string; motivo: string | null; money_signal: string | null; refund_review: string; actor_rol: string } | null
  declaraciones: Array<{ claim_id: string; estado: string; metodo: string; monto_declarado: number; referencia: string | null; comprobante: string | null
                         declarada_at: string; resuelta_at: string | null; motivo_rechazo: string | null; entry_id: string | null }>
  asientos: Array<{ entry_id: string; direccion: 'in' | 'out'; metodo: string; monto: number; fecha_valor: string; claim_id: string | null; refund_id: string | null; reversal_of: string | null; registrado_at: string }>
  reembolsos: Array<{ refund_id: string; tipo: string; monto: number; motivo: string | null; autorizado_at: string; pagado: boolean }>
  evidencia_resolucion: string[] | null
  fecha_relevante: string | null
}
export interface RevisionEconomica {
  generado_at: string
  casos: CasoRevision[]
  resumen: { abiertos: number; resueltos: number; por_incidencia: Partial<Record<Incidencia, number>>; nota: string; stripe_anomalias: string }
}
export type ErrorRevision = { tipo: 'no_autorizado' | 'sin_backend' | 'error'; mensaje: string }
export type ResultadoRevision = { ok: true; data: RevisionEconomica } | { ok: false; error: ErrorRevision }

export const ETIQUETA_INCIDENCIA: Record<Incidencia, string> = {
  declaracion_abierta_en_cancelado: 'Declaración abierta en pedido cancelado',
  dinero_sin_reembolso_autorizado: 'Dinero recibido sin reembolso autorizado',
  reembolso_autorizado_pendiente: 'Reembolso autorizado pendiente de pago',
  cancelacion_sin_evidencia: 'Cancelación sin evidencia económica verificable',
}
/** Qué se hace con cada incidencia — SIEMPRE con el flujo canónico existente; aquí no hay reparaciones. */
export const ORIENTACION_INCIDENCIA: Record<Incidencia, string> = {
  declaracion_abierta_en_cancelado: 'Verifica el comprobante (si el dinero llegó, se registra y quedará por reembolsar) o recházalo con motivo.',
  dinero_sin_reembolso_autorizado: 'Autoriza el reembolso desde el detalle del pedido en Ventas.',
  reembolso_autorizado_pendiente: 'Registra el pago del reembolso desde el detalle del pedido en Ventas.',
  cancelacion_sin_evidencia: 'No hay acción automática: revísalo manualmente con el proveedor de pago antes de cerrar.',
}

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

export class ClienteRevisionEconomica {
  constructor(private rpc: Rpc = rpcPorDefecto) {}
  async leer(incluirResueltos = false): Promise<ResultadoRevision> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, error: { tipo: 'sin_backend', mensaje: 'La revisión económica requiere conexión con el servidor.' } }
    try {
      const { data, error } = await this.rpc('revision_economica', { p_incluir_resueltos: incluirResueltos })
      if (error) {
        const noAut = /NO_AUTORIZADO|permission denied/.test(error.message ?? '')
        return { ok: false, error: noAut ? { tipo: 'no_autorizado', mensaje: 'Solo Dirección y Facturación pueden consultar la revisión económica.' }
                                         : { tipo: 'error', mensaje: 'No se pudo leer la revisión económica. Intenta de nuevo.' } }
      }
      return { ok: true, data: data as RevisionEconomica }
    } catch { return { ok: false, error: { tipo: 'error', mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } } }
  }
}
export const revisionEconomica = new ClienteRevisionEconomica()

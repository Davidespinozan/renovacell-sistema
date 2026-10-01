// W3-A · INTENCIÓN FISCAL — el frontend habla con los comandos del servidor, nunca con
// la evidencia fiscal.
//
// Antes: la pantalla invocaba la Edge Function `cfdi`, y ante CUALQUIER fallo (incluido un
// timeout después de que el PAC ya hubiera timbrado) escribía `invoice_meta = null` sobre el
// pedido, destruyendo el único rastro del folio y volviendo a ofrecer "Emitir CFDI". Ese
// camino ya no existe: `orders.invoice_meta` es una proyección server-side y la base rechaza
// cualquier escritura del cliente con FISCAL_SOLO_POR_COMANDO.
//
// Aquí solo se REGISTRA la intención (solicitar_cfdi) y se LEE el estado (estado_fiscal_pedido).
// El timbrado real llega en W3-B; hasta entonces `timbrado_habilitado` es falso y esta capa
// no ofrece reintento cuando el estado es `incierto`.
import { hasSupabase, supabase } from '../../lib/supabase'
import type { Json } from '../database.types'
import { AMBIGUO_MSG, isAmbiguous, newOpId, w1Message } from './w1Command'
import type { FiscalProfile } from './fiscal'
import { normalizeFiscalProfile } from './fiscal'

export type EstadoFiscal =
  | 'sin_solicitud' | 'pendiente' | 'en_proceso' | 'timbrado' | 'fallido' | 'incierto' | 'cancelado'

export interface EstadoFiscalPedido {
  doc_id?: string
  status: EstadoFiscal
  uuid?: string | null
  /** Identidad ante el PAC, asignada por el servidor (D-W3-7). El cliente nunca la elige. */
  serie?: string | null
  folio?: string | null
  provider_env?: string | null
  attempts?: number
  error_code?: string | null
  error_message?: string | null
  puede_solicitar: boolean
  puede_reintentar: boolean
  requiere_conciliacion: boolean
  requiere_revision_manual?: boolean
  /** Reenvío IDEMPOTENTE (misma Folio+Date), NO un reintento. Caduca con la ventana segura. */
  replay_permitido?: boolean
  replay_vence_en?: string | null
  timbrado_habilitado: boolean
  updated_at?: string
}

export type FiscalResult<T> = { ok: true; data: T } | { ok: false; error: string; ambiguous?: boolean }

// Estado por defecto sin backend (demo): no hay intención fiscal registrada.
export const SIN_SOLICITUD: EstadoFiscalPedido = {
  status: 'sin_solicitud', puede_solicitar: true, puede_reintentar: false,
  requiere_conciliacion: false, requiere_revision_manual: false,
  replay_permitido: false, timbrado_habilitado: false,
}

// Mensaje de operador para cada estado. `incierto` NUNCA invita a reintentar: las tres
// cosas que tiene que comunicar son que no se sabe si el CFDI existe, que volver a
// emitir está prohibido, y que hace falta conciliar.
export function mensajeEstadoFiscal(e: EstadoFiscalPedido): string {
  const id = e.serie && e.folio ? ` · ${e.serie}-${e.folio}` : ''
  switch (e.status) {
    case 'sin_solicitud': return 'Sin solicitud de factura.'
    case 'pendiente':     return 'Factura solicitada. Queda registrada y no se pierde; la emisión se habilita cuando Dirección cierre las decisiones fiscales pendientes.'
    case 'en_proceso':    return `Se está timbrando${id}. Espera a que termine; no lo vuelvas a enviar.`
    case 'timbrado':      return `CFDI emitido${id}${e.uuid ? ` · folio fiscal ${e.uuid}` : ''}.`
    case 'fallido':       return `No se emitió${e.error_message ? `: ${e.error_message}` : '.'}`
    case 'incierto':      return e.requiere_revision_manual
      ? `No sabemos si el SAT ya timbró este pedido${id}, y la búsqueda encontró más de un comprobante posible. Requiere revisión manual de Dirección. No se puede volver a emitir.`
      : `No sabemos si el SAT ya timbró este pedido${id}. Volver a emitir está PROHIBIDO: podría generar una factura duplicada ante el SAT. Dirección debe conciliarlo.`
    case 'cancelado':     return `CFDI cancelado${id}.`
    default:              return 'Estado fiscal desconocido.'
  }
}

// Etiqueta corta para listados y pastillas.
export function etiquetaEstadoFiscal(e: EstadoFiscalPedido): string {
  switch (e.status) {
    case 'sin_solicitud': return 'Sin factura'
    case 'pendiente':     return 'Solicitada'
    case 'en_proceso':    return 'Timbrando'
    case 'timbrado':      return 'Emitido'
    case 'fallido':       return 'No emitido'
    case 'incierto':      return e.requiere_revision_manual ? 'Revisión manual' : 'Sin confirmar'
    case 'cancelado':     return 'Cancelado'
    default:              return 'Desconocido'
  }
}

// SOLICITA la factura: crea (o corrige) la intención durable del pedido. No timbra.
export async function solicitarCFDI(
  orderId: string, receiver?: FiscalProfile | null,
): Promise<FiscalResult<{ status: string; doc_id?: string }>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor: la solicitud de factura no se registró.' }
  const { data, error } = await supabase.rpc('solicitar_cfdi', {
    p_op_id: newOpId(),
    p_order_id: orderId,
    p_receiver: (receiver ? normalizeFiscalProfile(receiver) : undefined) as Json | undefined,
  })
  if (error) {
    if (isAmbiguous(error)) return { ok: false, error: AMBIGUO_MSG, ambiguous: true }
    return { ok: false, error: w1Message(error.message) }
  }
  const r = (data ?? {}) as { status?: string; doc_id?: string }
  return { ok: true, data: { status: r.status ?? 'applied', doc_id: r.doc_id } }
}

// LEE el estado fiscal del pedido. Es la proyección autoritativa: la UI no lo deduce.
export async function estadoFiscalPedido(orderId: string): Promise<EstadoFiscalPedido> {
  if (!hasSupabase) return SIN_SOLICITUD
  const { data, error } = await supabase.rpc('estado_fiscal_pedido', { p_order: orderId })
  if (error || !data) return SIN_SOLICITUD
  return data as unknown as EstadoFiscalPedido
}

// DESCARTA una solicitud que nunca salió (pendiente → fallido). Un estado `incierto` NO se
// descarta por aquí: se concilia contra el PAC.
export async function descartarSolicitudCFDI(docId: string, motivo: string): Promise<FiscalResult<{ status: string }>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('descartar_solicitud_cfdi',
    { p_op_id: newOpId(), p_doc_id: docId, p_motivo: motivo })
  if (error) {
    if (isAmbiguous(error)) return { ok: false, error: AMBIGUO_MSG, ambiguous: true }
    return { ok: false, error: w1Message(error.message) }
  }
  return { ok: true, data: (data ?? { status: 'applied' }) as { status: string } }
}

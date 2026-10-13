// PAQ-B · Anular la guía de paquetería de un pedido que aún no sale del local (comando `anular_guia` del servidor).
// El servidor decide todo (quién, cuándo, y que el paquete siga en el local); aquí solo se pide y se traduce el motivo
// del rechazo. Idempotente: el mismo `opId` no anula dos veces.
import { hasSupabase, supabase } from '../../lib/supabase'

export type ResultadoAnular = { ok: true; guia: string } | { ok: false; error: string; ambiguo: boolean }
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

const MENSAJES: Record<string, string> = {
  NO_AUTORIZADO: 'Solo Dirección, Almacén o Empaque pueden anular una guía.',
  MOTIVO_REQUERIDO: 'Indica por qué se anula la guía (al menos 3 letras).',
  PEDIDO_INEXISTENTE: 'Ese pedido no existe o no tienes acceso a él.',
  PEDIDO_NO_ENVIADO: 'Ese pedido ya no está marcado como enviado; recarga para ver su estado.',
  SIN_GUIA: 'Ese pedido no tiene una guía de paquetería vigente.',
  ENVIO_CON_CHOFER: 'Ese envío lo lleva un chofer propio; no hay guía de paquetería que anular.',
  ENVIO_CERRADO: 'Ese envío ya está cerrado.',
  RECOLECCION_AGENDADA: 'Primero cancela la recolección agendada con la paquetería.',
  PAQUETE_EN_PAQUETERIA: 'La paquetería ya reporta movimiento del paquete: la guía ya no se anula. Si hay que traerlo de vuelta, registra una devolución.',
  GUIA_EN_PROCESO: 'Hay una guía en creación o en estado desconocido para este pedido; debe resolverse antes de anular.',
  OP_ID_REUTILIZADO: 'Esa operación ya se usó con otros datos. Vuelve a intentarlo.',
  CUENTA_SUSPENDIDA: 'Tu acceso fue suspendido por Dirección.',
}
export function mensajeAnular(m: string | undefined): string {
  const codigo = /^([A-Z_]{4,})\b/.exec(m ?? '')?.[1] ?? ''
  return MENSAJES[codigo] ?? 'No se pudo anular la guía. Intenta de nuevo.'
}

export async function anularGuia(orderId: string, motivo: string, opId: string, rpc: Rpc = rpcPorDefecto): Promise<ResultadoAnular> {
  if (!hasSupabase && rpc === rpcPorDefecto) return { ok: false, error: 'Anular una guía requiere conexión con el servidor.', ambiguo: false }
  try {
    const { data, error } = await rpc('anular_guia', { p_op_id: opId, p_order: orderId, p_motivo: motivo })
    if (error) {
      // Sin código de negocio reconocible (red, 5xx) el resultado es DESCONOCIDO: reintentar con el mismo opId es seguro.
      const conocido = /^[A-Z_]{4,}\b/.test(error.message ?? '')
      return { ok: false, error: conocido ? mensajeAnular(error.message) : 'No se pudo confirmar si la guía quedó anulada. Vuelve a intentarlo: no se anulará dos veces.', ambiguo: !conocido }
    }
    const d = (data ?? {}) as { status?: string; guia_anulada?: string }
    if (d.status === 'applied' || d.status === 'already_applied') return { ok: true, guia: d.guia_anulada ?? '' }
    return { ok: false, error: 'El servidor no confirmó la anulación.', ambiguo: true }
  } catch { return { ok: false, error: 'No hay conexión con el servidor. Vuelve a intentarlo: no se anulará dos veces.', ambiguo: true } }
}

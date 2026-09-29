// Cliente ÚNICO de los comandos de inventario/pedido de W1 (RPC SECURITY DEFINER).
//
// Contrato:
//  · Cada intención del usuario lleva un `op_id` estable (newOpId / useOpId). Un
//    reintento de la MISMA intención reusa el MISMO op_id → el servidor no duplica
//    (devuelve `already_applied`). Una intención NUEVA usa un op_id nuevo.
//  · Nunca hay éxito optimista: el resultado es el que confirma el servidor.
//  · Error de NEGOCIO (RAISE 'CODIGO: …') ⇒ definitivo, mensaje de operador.
//  · Falla de TRANSPORTE (red, timeout, 5xx sin código) ⇒ AMBIGUO: se consulta
//    `inv_estado_operacion(op_id)`; si el servidor ya la registró ⇒ éxito; si no,
//    se reporta ambiguo (NUNCA "no se aplicó") y la pantalla reintenta con el mismo op_id.
import { supabase } from '../../lib/supabase'
import type { Database } from '../database.types'

type Fns = Database['public']['Functions']
// Comandos W1 que pasan por este cliente (firmas tipadas desde database.types.ts).
export type W1Rpc =
  | 'recibir_lote' | 'importar_lote' | 'cerrar_orden_compra' | 'ajustar_lote' | 'surtir_pedido' | 'vender_pos'
  | 'cancelar_pedido' | 'confirmar_reingreso' | 'recibir_devolucion' | 'disponer_devolucion' | 'anular_guia_manual'
export type W1Args<F extends W1Rpc> = Fns[F]['Args']

export type W1Status = 'applied' | 'already_applied' | 'already_cancelled' | string

export type W1Result<T = Record<string, unknown>> =
  | { ok: true; status: W1Status; data: T }
  | { ok: false; error: string; code?: string; ambiguous?: boolean }

export const newOpId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))

// Mensajes de operador para los códigos que RAISEan los comandos W1.
const MENSAJES: Record<string, string> = {
  NO_AUTORIZADO: 'No tienes permiso para esta operación.',
  OP_ID_REUTILIZADO: 'Esta operación ya se registró con otros datos. Recarga la pantalla para ver el estado real antes de volver a intentar.',
  OP_ID_REQUERIDO: 'Falta el identificador de la operación. Recarga la pantalla.',
  MOTIVO_REQUERIDO: 'Escribe el motivo — es obligatorio.',
  CADUCIDAD_REQUERIDA: 'Indica la fecha de caducidad del lote.',
  CADUCIDAD_INVALIDA: 'La fecha de caducidad no es válida.',
  CADUCADO_NO_RECIBIBLE: 'Ese producto ya está caducado: no puede entrar como stock.',
  LOTE_CADUCIDAD_DISTINTA: 'Ese lote ya existe con otra fecha de caducidad. Revisa el código y la fecha: no se fusionan.',
  LOTE_REQUERIDO: 'Falta el código de lote.',
  CANTIDAD_INVALIDA: 'La cantidad debe ser mayor a cero.',
  RECEPCION_EXCEDE_PENDIENTE: 'La cantidad supera lo pendiente de la orden. El excedente se registra aparte con autorización de Dirección.',
  ORDEN_CERRADA: 'La orden ya está cerrada y no se reabre. Genera una orden nueva.',
  ORDEN_NO_ABIERTA: 'La orden ya no está abierta.',
  ORDEN_PRODUCTO_DISTINTO: 'La orden es de otro producto.',
  ORDEN_REQUERIDA: 'Selecciona la orden de compra o producción.',
  PEDIDO_INEXISTENTE: 'No se encontró el pedido.',
  PEDIDO_CANCELADO: 'El pedido está cancelado.',
  PEDIDO_YA_SURTIDO: 'Ese pedido ya fue surtido.',
  PEDIDO_NO_SURTIBLE: 'Ese pedido todavía no se puede surtir (debe estar pagado).',
  PEDIDO_SIN_RENGLONES: 'El pedido no tiene productos.',
  ASIGNACION_INCOMPLETA: 'Las cantidades por lote no cuadran con el pedido. Recarga el inventario y vuelve a intentar.',
  ASIGNACION_INVALIDA: 'Hay una asignación que no corresponde al pedido. Recarga e intenta de nuevo.',
  LOTE_DE_OTRO_PRODUCTO: 'Un lote asignado no corresponde al producto.',
  LOTE_CADUCADO: 'Un lote asignado está caducado; no se puede surtir ni vender.',
  INVENTARIO_INSUFICIENTE: 'No hay existencia suficiente en el lote. Recarga el inventario.',
  CANCELACION_REQUIERE_DIRECCION: 'Este pedido solo lo puede cancelar Dirección (ya hay pago o evidencia de pago).',
  USAR_DEVOLUCION: 'El pedido ya salió o se entregó: no se cancela, se registra una devolución.',
  GUIA_ACTIVA: 'El pedido tiene una guía de paquetería activa. Dirección debe registrar su anulación antes de cancelar.',
  GUIA_EN_RECONCILIACION: 'La guía está en estado desconocido con la paquetería; requiere reconciliación antes de anularla.',
  GUIA_EN_PROCESO: 'La guía todavía se está generando. Espera a que termine.',
  GUIA_NO_ANULABLE: 'Esa guía no se puede anular.',
  REFERENCIA_REQUERIDA: 'Escribe la referencia de la anulación en el portal de la paquetería.',
  REINGRESO_YA_CONFIRMADO: 'Ese reingreso ya fue confirmado.',
  REINGRESO_INCOMPLETO: 'Confirma cada renglón pendiente una sola vez.',
  DEVOLUCION_NO_PERMITIDA: 'Ese pedido no admite devolución en su estado actual.',
  DEVOLUCION_EXCEDE_SURTIDO: 'No se puede devolver más de lo que salió de ese lote en el pedido.',
  LOTE_NO_SURTIDO_EN_PEDIDO: 'Ese lote no salió en este pedido.',
  INSPECCION_REQUERIDA: 'Indica si cada producto llegó en buen estado o dañado.',
  VENDIBLE_NO_PERMITIDO: 'Ese producto no puede regresar a venta (dañado o caducado); solo a merma.',
  LINEA_YA_DISPUESTA: 'Ese renglón ya tiene destino asignado.',
  LINEA_SIN_INSPECCION: 'Almacén todavía no confirma ese reingreso.',
  MERMA_DEBE_SER_NEGATIVA: 'Una merma solo da de baja unidades.',
  CORRECCION_EXCEDE_RECEPCION: 'La corrección excede lo recibido en esa recepción.',
  PEDIDO_EXISTENTE: 'Ese identificador de venta ya pertenece a otro pedido. Recarga la caja.',
}

// Extrae el código de negocio ('CODIGO: detalle') o el nombre de restricción.
export function w1Code(message: string): string | undefined {
  const m = /\b([A-Z][A-Z0-9_]{3,})(?=:|\b)/.exec(message)
  return m && MENSAJES[m[1]] ? m[1] : m?.[1]
}

export function w1Message(message: string): string {
  const code = w1Code(message)
  if (code && MENSAJES[code]) {
    // Conserva el detalle numérico del servidor (p. ej. "pendiente 40") cuando lo hay.
    const detail = message.includes(':') ? message.slice(message.indexOf(':') + 1).trim() : ''
    const base = MENSAJES[code]
    return /\d/.test(detail) && !['OP_ID_REUTILIZADO'].includes(code) ? `${base} (${detail})` : base
  }
  return message.replace(/^[A-Z_]+:\s*/, '') || 'No se pudo completar la operación.'
}

// ¿La falla es de transporte (resultado desconocido) y no una respuesta del servidor?
export function isAmbiguous(err: { message?: string; code?: string; status?: number } | null | undefined): boolean {
  if (!err) return false
  const msg = err.message ?? ''
  if (/Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout|timed out|aborted|ECONN/i.test(msg)) return true
  if (!err.code && (err.status === undefined || err.status >= 500 || err.status === 0)) return !/[A-Z_]{4,}:/.test(msg)
  return false
}

export const AMBIGUO_MSG = 'No se pudo confirmar la operación con el servidor. Reintenta: el sistema NO la duplicará.'

// Consulta si el servidor ya registró la operación (recuperación tras respuesta ambigua).
export async function estadoOperacion(opId: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.rpc('inv_estado_operacion', { p_op_id: opId })
    if (error) return null
    return (data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null)
  } catch {
    return null
  }
}

export async function runW1Command<T = Record<string, unknown>, F extends W1Rpc = W1Rpc>(rpc: F, params: W1Args<F>, opId: string): Promise<W1Result<T>> {
  let resp: { data: unknown; error: { message?: string; code?: string; status?: number } | null }
  try {
    // Firma verificada en compilación contra database.types.ts (args con nombre = PostgREST).
    resp = await supabase.rpc(rpc, params as Fns[F]['Args']) as unknown as typeof resp
  } catch (e) {
    resp = { data: null, error: { message: (e as Error)?.message ?? 'network' } }
  }
  const { data, error } = resp
  if (error) {
    if (isAmbiguous(error)) {
      const prev = await estadoOperacion(opId)
      if (prev) return { ok: true, status: 'already_applied', data: prev as T }
      return { ok: false, ambiguous: true, error: AMBIGUO_MSG }
    }
    const msg = error.message ?? ''
    return { ok: false, code: w1Code(msg), error: w1Message(msg) }
  }
  const obj = (data && typeof data === 'object' ? data : { value: data }) as Record<string, unknown>
  return { ok: true, status: (obj.status as string) ?? 'applied', data: obj as T }
}

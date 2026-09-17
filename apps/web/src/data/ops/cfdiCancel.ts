// Cancelación fiscal de CFDI (motivos 02/03) y sincronización de estatus pendiente. El cliente
// NUNCA habla con Facturama ni ve credenciales ni envía facturama_id/uuid: solo manda order_id y
// motivo. La cancelación NO modifica pedido/pago/inventario/comisión (evento fiscal separado).
import { supabase } from '../../lib/supabase'
import { notify } from '../store/notificationsStore'

export type MotivoCancel = '02' | '03'
export type CancelStatus = 'cancelada' | 'pendiente' | 'rechazada'

const MSG: Record<CancelStatus, string> = {
  cancelada: 'CFDI cancelado ante el SAT',
  pendiente: 'Cancelación solicitada · pendiente de aceptación',
  rechazada: 'La cancelación no se realizó (el CFDI sigue vigente)',
}

async function reason(error: unknown): Promise<string> {
  try {
    const b = await (error as { context?: { json?: () => Promise<{ message?: string; error?: string }> } })?.context?.json?.()
    return b?.message ?? b?.error ?? ''
  } catch { return '' }
}

// Devuelve el nuevo estado si Facturama respondió; null si hubo error (ya notificado).
export async function cancelCfdi(orderId: string, motive: MotivoCancel): Promise<CancelStatus | null> {
  const { data, error } = await supabase.functions.invoke('cfdi-cancel', { body: { order_id: orderId, motive, confirm: true } })
  if (error || !data?.ok) {
    const r = await reason(error)
    notify({ text: `Cancelación · ${r || 'no se pudo cancelar el CFDI'}`, roles: ['admin'], screen: 'av_fin' })
    console.warn('[cfdi-cancel]', (error as { message?: string })?.message, r)
    return null
  }
  const status = data.cancel?.status as CancelStatus
  notify({ text: `Cancelación · ${MSG[status] ?? 'estado actualizado'}`, roles: ['admin'], screen: 'av_fin' })
  return status
}

// Sincroniza el estatus de una cancelación PENDIENTE (solo lectura remota; nunca cancela).
export async function refreshCancelStatus(orderId: string): Promise<CancelStatus | null> {
  const { data, error } = await supabase.functions.invoke('cfdi-cancel-status', { body: { order_id: orderId } })
  if (error || !data?.ok) {
    const r = await reason(error)
    notify({ text: `Cancelación · ${r || 'no se pudo actualizar el estatus'}`, roles: ['admin'], screen: 'av_fin' })
    console.warn('[cfdi-cancel-status]', (error as { message?: string })?.message, r)
    return null
  }
  const status = data.cancel?.status as CancelStatus
  if (data.changed) notify({ text: `Cancelación · ${MSG[status] ?? 'estado actualizado'}`, roles: ['admin'], screen: 'av_fin' })
  return status
}

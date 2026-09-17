// Envío bajo demanda del CFDI al cliente por email. El cliente NUNCA habla con Facturama ni ve
// sus credenciales: invoca la Edge Function `cfdi-send` (que las tiene server-side). Facturama
// entrega el CFDI (XML+PDF) al destinatario. La trazabilidad vive en audit_logs (server-side).
import { supabase } from '../../lib/supabase'
import { notify } from '../store/notificationsStore'

// Validación de email en cliente (para bloquear antes del invoke cuando sea posible).
// Debe coincidir con la del backend (rules.ts::emailValido).
export function emailValido(email: string): boolean {
  const e = email.trim()
  if (!e || e.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

// Devuelve true si Facturama confirmó el envío; false si hubo error (ya notificado).
export async function sendCfdi(orderId: string, email?: string): Promise<boolean> {
  const clean = (email ?? '').trim().toLowerCase()
  const body: { order_id: string; email?: string } = { order_id: orderId }
  if (clean) body.email = clean

  const { data, error } = await supabase.functions.invoke('cfdi-send', { body })
  if (error || !data?.ok) {
    let reason = ''
    try {
      const b = await (error as { context?: { json?: () => Promise<{ message?: string; error?: string }> } })?.context?.json?.()
      reason = b?.message ?? b?.error ?? ''
    } catch { /* noop */ }
    notify({ text: `Factura · ${reason || 'no se pudo enviar el CFDI'}`, roles: ['admin'], screen: 'av_fin' })
    console.warn('[cfdi-send]', (error as { message?: string })?.message, reason)
    return false
  }
  notify({ text: `Factura enviada a ${data.email}`, roles: ['admin'], screen: 'av_fin' })
  return true
}

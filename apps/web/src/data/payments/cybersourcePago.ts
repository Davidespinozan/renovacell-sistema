// CS-1A.5 · cobro con tarjeta desde el portal del doctor: llama a la Edge `cs-pago` con el intento autenticado y el token
// transitorio (en memoria). El navegador no manda importes ni referencias; el resultado lo decide el servidor y solo
// `posted` significa pago confirmado y registrado.
import { supabase, hasSupabase } from '../../lib/supabase'

export type EstadoPago = 'posted' | 'captured' | 'authorized' | 'declined' | 'unknown_requires_reconciliation' | 'amount_changed' | 'authz_sent' | string
export interface RespPago { estado: EstadoPago; pagado: boolean; amount: number; ambiente: 'test' | 'production'; message: string | null; detalle?: string; repetido?: boolean; saldo?: number; payment_status?: string }
export type ResultadoPago = { ok: true; data: RespPago } | { ok: false; error: string; message: string; estado?: string; saldo_vigente?: number }

async function cuerpoDeError(e: unknown): Promise<{ error?: string; message?: string; estado?: string; saldo_vigente?: number } | null> {
  try { return await (e as { context?: { json?: () => Promise<{ error?: string; message?: string; estado?: string; saldo_vigente?: number }> } }).context?.json?.() ?? null } catch { return null }
}
async function llamar(body: Record<string, unknown>): Promise<ResultadoPago> {
  if (!hasSupabase) return { ok: false, error: 'not_configured', message: 'El pago con tarjeta aún no está disponible.' }
  const { data, error } = await supabase.functions.invoke('cs-pago', { body })
  if (error) {
    const b = await cuerpoDeError(error)
    return { ok: false, error: b?.error ?? 'error', message: b?.message ?? 'No se pudo procesar el pago. Consulta el estado antes de reintentar.', estado: b?.estado, saldo_vigente: b?.saldo_vigente }
  }
  return { ok: true, data: data as RespPago }
}
export const csPago = {
  /** UNA solicitud de cobro para un intento autenticado. El servidor impide segundos cargos. */
  pagar: (attemptId: string, token: string) => llamar({ accion: 'pagar', attempt_id: attemptId, token }),
  /** Estado real del intento (recuperación tras recarga o cierre). Nunca dispara un cargo. */
  estado: (attemptId: string) => llamar({ accion: 'estado', attempt_id: attemptId }),
}

/**
 * CS-BB · red de seguridad del portal: el servidor ya manda mensajes en español, pero si alguna vez llegara texto técnico del banco
 * (códigos en MAYÚSCULAS, "CyberSource", status=…, separadores "·"), el doctor ve un mensaje genérico. El detalle técnico vive solo
 * en los logs del servidor y en la bitácora del intento.
 */
export const MENSAJE_GENERICO_PAGO = 'Tu banco rechazó el pago. Puedes intentar con otra tarjeta u otra forma de pago.'
export function mensajeSeguroPago(texto: string | null | undefined): string {
  const t = String(texto ?? '').trim()
  if (!t) return ''
  if (/cybersource|cardinal|\b[A-Z]{2,}_[A-Z_]+\b|\b(DECLINED|INVALID_REQUEST|AUTHORIZED|PENDING)\b|status=|paresStatus|·|\{|\bHTTP\b|\b[45]\d\d:/i.test(t)) return MENSAJE_GENERICO_PAGO
  return t.slice(0, 300)
}

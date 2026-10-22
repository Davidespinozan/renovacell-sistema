// CS-1A.6 · acceso de Dirección/Facturación a la conciliación de cobros con tarjeta: lista de intentos que requieren atención
// (lectura directa con RLS: admin/billing ven todos) y acciones administrativas vía la Edge `cs-conciliar`.
import { supabase, hasSupabase } from '../../lib/supabase'

export const ESTADOS_ATENCION = ['authz_sent', 'authorized', 'captured', 'unknown_requires_reconciliation'] as const
export interface IntentoAdmin {
  id: string; order_id: string; folio: string | null; ambiente: 'test' | 'production'; amount: number; status: string; status_at: string; created_at: string
  cs_payment_id: string | null; cs_payment_status: string | null; cs_reason: string | null; cs_request_sent_at: string | null; entry_id: string | null; error_safe: string | null
  reconciled_at: string | null; reconcile_note: string | null
}
export interface EventoIntento { id: number; from_status: string | null; to_status: string; actor: string | null; actor_role: string | null; detalle: Record<string, unknown> | null; created_at: string }

export async function listarIntentosAtencion(): Promise<{ ok: true; intentos: IntentoAdmin[] } | { ok: false; mensaje: string }> {
  if (!hasSupabase) return { ok: true, intentos: [] }
  const { data, error } = await supabase.from('card_payment_attempts')
    .select('id, order_id, ambiente, amount, status, status_at, created_at, cs_payment_id, cs_payment_status, cs_reason, cs_request_sent_at, entry_id, error_safe, reconciled_at, reconcile_note')
    .in('status', [...ESTADOS_ATENCION]).order('status_at', { ascending: true }).limit(200)
  if (error) return { ok: false, mensaje: 'No se pudo leer la lista de cobros con tarjeta.' }
  const rows = (data ?? []) as Omit<IntentoAdmin, 'folio'>[]
  const ids = [...new Set(rows.map((r) => r.order_id))]
  const folios = new Map<string, string | null>()
  if (ids.length) {
    const { data: ords } = await supabase.from('orders').select('id, external_ref').in('id', ids)
    for (const o of (ords ?? []) as Array<{ id: string; external_ref: string | null }>) folios.set(o.id, o.external_ref)
  }
  return { ok: true, intentos: rows.map((r) => ({ ...r, folio: folios.get(r.order_id) ?? null })) }
}

export async function listarEventos(attemptId: string): Promise<EventoIntento[]> {
  if (!hasSupabase) return []
  const { data } = await supabase.from('card_payment_attempt_events').select('id, from_status, to_status, actor, actor_role, detalle, created_at').eq('attempt_id', attemptId).order('id', { ascending: true })
  return (data ?? []) as EventoIntento[]
}

export type AccionConciliar = 'consultar' | 'resolver' | 'capturar' | 'reversar' | 'contabilizar' | 'cerrar_manual'
export interface RespConciliar { estado: string; aplicado?: boolean; hallazgo?: Record<string, unknown>; sugerencia?: { accion: string; motivo: string }; message?: string; error?: string; entry_id?: string; como?: string; horas?: number | null; cierre_manual_posible?: boolean }
export type ResultadoConciliar = { ok: true; data: RespConciliar } | { ok: false; error: string; message: string; estado?: string; hallazgo?: Record<string, unknown> }
/** CS-1A.7 · el cierre manual sin cargo exige, además del motivo, la declaración de revisión del Business Center (la Edge y la base la verifican). */
export interface ExtraConciliar { business_center_revisado?: boolean }
export const HORAS_CIERRE_MANUAL = 24
export const MOTIVO_MINIMO_CIERRE = 10
/** Horas desde lo más tardío entre el envío al banco y el estado actual: misma regla que la base; aquí solo orienta a la pantalla. */
export function horasParaCierre(i: Pick<IntentoAdmin, 'cs_request_sent_at' | 'status_at'>, ahora = Date.now()): number | null {
  const hs = [i.cs_request_sent_at, i.status_at].filter((x): x is string => !!x).map((x) => (ahora - new Date(x).getTime()) / 3600000).filter((x) => Number.isFinite(x))
  return hs.length ? Math.min(...hs) : null
}
async function cuerpoDeError(e: unknown): Promise<Record<string, unknown> | null> {
  try { return await (e as { context?: { json?: () => Promise<Record<string, unknown>> } }).context?.json?.() ?? null } catch { return null }
}
export async function conciliar(accion: AccionConciliar, attemptId: string, motivo?: string, extra?: ExtraConciliar): Promise<ResultadoConciliar> {
  if (!hasSupabase) return { ok: false, error: 'not_configured', message: 'Sin backend.' }
  const { data, error } = await supabase.functions.invoke('cs-conciliar', { body: { accion, attempt_id: attemptId, motivo, ...(extra ?? {}) } })
  if (error) {
    const b = await cuerpoDeError(error)
    return { ok: false, error: String(b?.error ?? 'error'), message: String(b?.message ?? 'No se pudo completar la acción.'), estado: b?.estado as string | undefined, hallazgo: b?.hallazgo as Record<string, unknown> | undefined }
  }
  return { ok: true, data: data as RespConciliar }
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  authz_sent: 'Enviado al banco sin respuesta registrada', authorized: 'Autorizado sin captura', captured: 'Capturado · asiento pendiente',
  unknown_requires_reconciliation: 'Resultado desconocido', posted: 'Contabilizado', declined: 'Rechazado / reversado', failed_safe_to_retry: 'Cerrado sin cargo',
}

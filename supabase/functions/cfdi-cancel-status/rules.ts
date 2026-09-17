// Reglas PURAS de sincronización de estatus de cancelación (solo lectura remota). Compartidas
// por la Edge Function `cfdi-cancel-status` y sus tests. Sin Deno/red. NO cancela (no DELETE).

export type CancelStatus = 'cancelada' | 'pendiente' | 'rechazada'

export interface StatusMeta {
  facturama_id?: string | null
  cancel?: { status?: string }
}

// Solo se puede consultar/sincronizar si la cancelación está PENDIENTE. Cualquier otro estado
// (o sin cancelación) no aplica → 409.
export function puedeConsultar(invoiceMeta: unknown): { ok: true; facturamaId: string } | { ok: false; error: string; message: string } {
  const m = (invoiceMeta ?? {}) as StatusMeta
  if (m.cancel?.status !== 'pendiente') {
    return { ok: false, error: 'not_pending', message: 'Solo se puede actualizar el estatus de una cancelación pendiente.' }
  }
  if (typeof m.facturama_id !== 'string' || m.facturama_id.length === 0) {
    return { ok: false, error: 'not_pending', message: 'El CFDI no tiene identificador de Facturama.' }
  }
  return { ok: true, facturamaId: m.facturama_id }
}

// Mapea el Status del detalle remoto (GET /cfdi/{id}) al estado interno. Desconocido → null
// (se conserva 'pendiente', sin cambios).
export function mapeaStatusDetalle(remote: unknown): CancelStatus | null {
  const s = typeof remote === 'string' ? remote.trim().toLowerCase() : ''
  if (s === 'canceled' || s === 'cancelled') return 'cancelada'
  if (s === 'pending') return 'pendiente'
  if (s === 'active' || s === 'vigente') return 'rechazada'
  return null
}

// Actualiza SOLO el bloque cancel.status (y confirmed_at si queda cancelada), PRESERVANDO el resto.
export function actualizaCancelStatus(existing: unknown, nuevo: CancelStatus, now: string): Record<string, unknown> {
  const base = (existing && typeof existing === 'object') ? { ...(existing as Record<string, unknown>) } : {}
  const prev = (base.cancel && typeof base.cancel === 'object') ? { ...(base.cancel as Record<string, unknown>) } : {}
  prev.status = nuevo
  if (nuevo === 'cancelada' && !prev.confirmed_at) prev.confirmed_at = now
  base.cancel = prev
  return base
}

// Acción de auditoría al sincronizar (null = sin cambio real → no auditar).
export function accionActualizacion(anterior: string | undefined, nuevo: CancelStatus): string | null {
  if (nuevo === anterior) return null
  if (nuevo === 'cancelada') return 'CFDI cancelado'
  if (nuevo === 'rechazada') return 'CFDI cancelación fallida'
  return null // pendiente → pendiente (sin cambio)
}

export async function auditarSeguro(rpc: () => Promise<{ error?: unknown } | null | undefined>): Promise<boolean> {
  try {
    const res = await rpc()
    if (res && (res as { error?: unknown }).error) { console.warn('[cfdi-cancel-status] auditoría no registrada (rpc error)'); return false }
    return true
  } catch {
    console.warn('[cfdi-cancel-status] auditoría no registrada (excepción)')
    return false
  }
}

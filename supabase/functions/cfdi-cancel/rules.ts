// Reglas PURAS de cancelación de CFDI (motivos 02/03) — compartidas por la Edge Function
// `cfdi-cancel` y por sus tests (vitest). Sin Deno/red. NO incluye motivo 01/04 ni sustitución.

export type MotivoCancel = '02' | '03'
export type CancelStatus = 'cancelada' | 'pendiente' | 'rechazada'

// Solo 02 y 03 en esta versión (01 requiere sustituto; 04 fuera de alcance).
export function motivoCancelValido(m: unknown): m is MotivoCancel {
  return m === '02' || m === '03'
}

export interface CancelMeta {
  status?: string
  uuid?: string
  facturama_id?: string | null
  simulated?: boolean
  cancel?: { status?: string }
}

// GATE: solo un CFDI TIMBRADO real (no simulado, con uuid + facturama_id) y que NO tenga ya una
// cancelación en curso o hecha (solicitada/pendiente/cancelada). 'rechazada' sí permite reintento.
export function puedeCancelar(
  invoiceMeta: unknown,
):
  | { ok: true; facturamaId: string; uuid: string }
  | { ok: false; error: string; message: string } {
  const m = (invoiceMeta ?? {}) as CancelMeta
  if (m.simulated === true) return { ok: false, error: 'not_cancelable', message: 'El CFDI es simulado (demo): no es cancelable.' }
  if (m.status !== 'timbrada' || typeof m.uuid !== 'string' || m.uuid.length === 0) {
    return { ok: false, error: 'not_cancelable', message: 'El pedido no tiene un CFDI timbrado cancelable.' }
  }
  if (typeof m.facturama_id !== 'string' || m.facturama_id.length === 0) {
    return { ok: false, error: 'not_cancelable', message: 'El CFDI no tiene identificador de Facturama.' }
  }
  const cs = m.cancel?.status
  if (cs === 'solicitada' || cs === 'pendiente' || cs === 'cancelada') {
    return { ok: false, error: 'already_requested', message: 'La cancelación ya fue solicitada o el CFDI ya está cancelado.' }
  }
  return { ok: true, facturamaId: m.facturama_id, uuid: m.uuid }
}

// Mapea el Status de Facturama al estado interno. Cualquier otro valor → null (se trata como error).
export function mapeaStatusCancelacion(facturamaStatus: unknown): CancelStatus | null {
  const s = typeof facturamaStatus === 'string' ? facturamaStatus.trim().toLowerCase() : ''
  if (s === 'canceled' || s === 'cancelled') return 'cancelada'
  if (s === 'pending') return 'pendiente'
  if (s === 'active') return 'rechazada'
  return null
}

// Acción de auditoría según el estado interno resultante.
export function accionAuditoria(status: CancelStatus): string {
  if (status === 'cancelada') return 'CFDI cancelado'
  if (status === 'pendiente') return 'CFDI cancelación solicitada'
  return 'CFDI cancelación fallida' // rechazada
}

export interface CancelInput {
  status: CancelStatus
  motive: MotivoCancel
  requested_at: string
  confirmed_at?: string
  expiration_at?: string
  is_cancelable?: string
  message?: string
  acuse_available: boolean
}

// Construye invoice_meta con el bloque `cancel`, PRESERVANDO todos los campos existentes
// (uuid/facturama_id/emitida_at/status/etc.). NUNCA persiste AcuseXmlBase64: solo acuse_available.
export function construyeCancelMeta(existing: unknown, input: CancelInput): Record<string, unknown> {
  const base = (existing && typeof existing === 'object') ? { ...(existing as Record<string, unknown>) } : {}
  const cancel: Record<string, unknown> = {
    status: input.status,
    motive: input.motive,
    requested_at: input.requested_at,
    acuse_available: input.acuse_available,
  }
  if (input.confirmed_at) cancel.confirmed_at = input.confirmed_at
  if (input.expiration_at) cancel.expiration_at = input.expiration_at
  if (input.is_cancelable) cancel.is_cancelable = input.is_cancelable
  if (input.message) cancel.message = input.message
  base.cancel = cancel
  return base
}

// CLAIM atómico: marca cancel.status='solicitada' con un claim_id efímero, PRESERVANDO el resto.
// Se persiste con un UPDATE condicional (WHERE cancel ausente/'rechazada') → solo un request gana.
export function construyeClaimMeta(existing: unknown, motive: MotivoCancel, requested_at: string, claimId: string): Record<string, unknown> {
  const base = (existing && typeof existing === 'object') ? { ...(existing as Record<string, unknown>) } : {}
  base.cancel = { status: 'solicitada', motive, requested_at, claim_id: claimId }
  return base
}

// Auditoría BEST-EFFORT: tolera {error} y excepción, nunca lanza (un fallo de auditoría no debe
// ocultar/alterar el resultado fiscal). No registra contenido fiscal/credenciales.
export async function auditarSeguro(rpc: () => Promise<{ error?: unknown } | null | undefined>): Promise<boolean> {
  try {
    const res = await rpc()
    if (res && (res as { error?: unknown }).error) { console.warn('[cfdi-cancel] auditoría no registrada (rpc error)'); return false }
    return true
  } catch {
    console.warn('[cfdi-cancel] auditoría no registrada (excepción)')
    return false
  }
}

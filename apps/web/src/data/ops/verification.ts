// Estado de verificación del doctor (Fase 1).
// AUTORIDAD DE ACCESO = profiles.verified (server-side, RLS is_verified). Este módulo
// NO reemplaza esa autoridad: solo aporta un ESTADO LEGIBLE que vive en
// profiles.meta.verification para distinguir situaciones que `verified=false` no
// separa por sí solo (nunca revisado vs rechazado vs revocado). Sin columna nueva.

export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'revoked'

export interface VerificationMeta {
  status: VerificationStatus
  reviewed_at?: string
  reviewed_by?: string | null
  reason?: string
}

// Deriva el estado a mostrar. `verified=true` manda (es la autoridad de acceso);
// si no está verificado, se usa meta.verification.status y por defecto 'pending'.
export function deriveVerificationStatus(p: { verified?: boolean | null; meta?: unknown }): VerificationStatus {
  if (p.verified) return 'verified'
  const s = (p.meta as { verification?: { status?: string } } | null | undefined)?.verification?.status
  if (s === 'rejected' || s === 'revoked' || s === 'pending' || s === 'verified') {
    // Un meta 'verified' obsoleto con verified=false NO debe reportar acceso.
    return s === 'verified' ? 'pending' : s
  }
  return 'pending'
}

export const VERIF_LABEL: Record<VerificationStatus, string> = {
  pending: 'Pendiente de verificación',
  verified: 'Verificado',
  rejected: 'Rechazado',
  revoked: 'Acceso revocado',
}

export const VERIF_PILL: Record<VerificationStatus, string> = {
  pending: 'p-warn',
  verified: 'p-ok',
  rejected: 'p-dang',
  revoked: 'p-dang',
}

// Construye el bloque meta.verification (merge no destructivo lo hace el llamador).
export function buildVerificationMeta(status: VerificationStatus, reviewedBy?: string | null, reason?: string): VerificationMeta {
  const v: VerificationMeta = { status, reviewed_at: new Date().toISOString() }
  if (reviewedBy !== undefined) v.reviewed_by = reviewedBy
  if (reason && reason.trim()) v.reason = reason.trim()
  return v
}

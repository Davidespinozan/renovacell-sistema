// Resolución de identidad de cliente — REGLAS ÚNICAS compartidas por el cockpit de aprobación
// y por el resolver server-side (resolve_customer_identity). Precedencia: profile_id →
// (source,external_id) → email norm → teléfono norm. El nombre NUNCA decide un match.
// Señales fuertes que apuntan a customers distintos, o una señal con >1 customer → AMBIGUOUS.
// Mantener en sincronía con supabase/migrations/20261010120000_customer_identity.sql.

// Email: trim + lowercase → null si vacío.
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  return e || null
}

// Teléfono: solo dígitos; últimos 10 (normaliza +52 / 52 / 521). < 10 dígitos = no confiable (null).
export function normalizePhone(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/[^0-9]/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

export type IdentityStatus = 'EXACT' | 'MATCH' | 'NOT_FOUND' | 'AMBIGUOUS'

export interface IdentityCustomer {
  id: string
  email?: string | null
  phone?: string | null
  profile_id?: string | null
  source?: string | null
  external_id?: string | null
  active?: boolean | null
}
export interface IdentitySignals {
  profile_id?: string | null
  external_id?: string | null
  source?: string | null
  email?: string | null
  phone?: string | null
  name?: string | null // auxiliar; no decide
}
export interface IdentityResolution {
  status: IdentityStatus
  customer_id: string | null
  signals: string[]
}

export function classifyIdentity(all: readonly IdentityCustomer[], s: IdentitySignals): IdentityResolution {
  // A) profile_id ya ligado → EXACT.
  if (s.profile_id) {
    const c = all.find((x) => x.profile_id === s.profile_id)
    if (c) return { status: 'EXACT', customer_id: c.id, signals: ['profile_id'] }
  }
  // B) (source, external_id) → EXACT.
  if (s.external_id && (s.source ?? '').trim()) {
    const c = all.find((x) => x.source === s.source && x.external_id === s.external_id)
    if (c) return { status: 'EXACT', customer_id: c.id, signals: ['external_id'] }
  }
  const email = normalizeEmail(s.email)
  const phone = normalizePhone(s.phone)
  const active = all.filter((x) => x.active !== false)
  const emailIds = email ? [...new Set(active.filter((x) => normalizeEmail(x.email) === email).map((x) => x.id))] : []
  const phoneIds = phone ? [...new Set(active.filter((x) => normalizePhone(x.phone) === phone).map((x) => x.id))] : []

  if (emailIds.length > 1 || phoneIds.length > 1) return { status: 'AMBIGUOUS', customer_id: null, signals: ['multiple'] }
  if (emailIds.length === 1 && phoneIds.length === 1) {
    return emailIds[0] === phoneIds[0]
      ? { status: 'MATCH', customer_id: emailIds[0], signals: ['email', 'phone'] }
      : { status: 'AMBIGUOUS', customer_id: null, signals: ['email_phone_conflict'] }
  }
  if (emailIds.length === 1) return { status: 'MATCH', customer_id: emailIds[0], signals: ['email'] }
  if (phoneIds.length === 1) return { status: 'MATCH', customer_id: phoneIds[0], signals: ['phone'] }
  return { status: 'NOT_FOUND', customer_id: null, signals: [] }
}

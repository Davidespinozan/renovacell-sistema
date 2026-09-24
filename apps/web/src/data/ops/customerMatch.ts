// Búsqueda de CANDIDATOS customer para vincular a un doctor al aprobarlo (Fase 1).
// REGLA DURA (auditoría): customers.email NO es único → NUNCA auto-vincular por email.
// Este módulo solo PROPONE candidatos y clasifica la resolución; la decisión final la
// toma un humano en el cockpit. No hace merge ni sobrescribe datos históricos.
import { normalizeEmail, normalizePhone, type Customer } from './customer'

const norm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const nameTokens = (s: string | null | undefined): string[] =>
  norm(s).split(' ').filter((t) => t.length >= 3)

export interface CandidateCriteria {
  email?: string | null
  phone?: string | null
  full_name?: string | null
}

export interface CustomerCandidate {
  customer: Customer
  score: number
  reasons: string[]      // 'email' | 'teléfono' | 'nombre'
  strong: boolean        // coincide email o teléfono (identidad fuerte)
  linkedToOther: boolean // ya vinculado a OTRO profile → no se puede reutilizar
}

// Devuelve candidatos ordenados por score desc. `profileId` = el doctor que se aprueba
// (para marcar como YA reutilizable si el customer ya está enlazado a ESE mismo profile).
export function findCustomerCandidates(
  all: readonly Customer[],
  c: CandidateCriteria,
  profileId?: string | null,
): CustomerCandidate[] {
  const email = normalizeEmail(c.email)
  const phone = normalizePhone(c.phone)
  const tokens = nameTokens(c.full_name)

  const out: CustomerCandidate[] = []
  for (const cust of all) {
    if (cust.active === false) continue
    let score = 0
    const reasons: string[] = []
    if (email && normalizeEmail(cust.email) === email) { score += 3; reasons.push('email') }
    if (phone && normalizePhone(cust.phone) === phone) { score += 3; reasons.push('teléfono') }
    if (tokens.length) {
      const ct = new Set(nameTokens(cust.full_name))
      const overlap = tokens.filter((t) => ct.has(t)).length
      if (overlap >= 2 || (tokens.length === 1 && overlap === 1)) { score += 1; reasons.push('nombre') }
    }
    if (score === 0) continue
    const strong = reasons.includes('email') || reasons.includes('teléfono')
    const linkedToOther = !!cust.profile_id && cust.profile_id !== profileId
    out.push({ customer: cust, score, reasons, strong, linkedToOther })
  }
  return out.sort((a, b) => b.score - a.score || (a.customer.full_name ?? '').localeCompare(b.customer.full_name ?? ''))
}

// Resolución sugerida para el admin. NUNCA decide sola cuando hay ambigüedad.
export type ApprovalResolution =
  | { kind: 'create' }                                       // sin candidato razonable → crear nuevo
  | { kind: 'confirm'; candidate: CustomerCandidate }        // exactamente 1 fuerte reutilizable → confirmar
  | { kind: 'choose'; candidates: CustomerCandidate[] }      // varios → el admin elige

export function resolveApproval(candidates: readonly CustomerCandidate[]): ApprovalResolution {
  const linkable = candidates.filter((c) => !c.linkedToOther)
  if (linkable.length === 0) return { kind: 'create' }              // nada reutilizable → crear
  const strong = linkable.filter((c) => c.strong)
  if (strong.length === 1 && linkable.length === 1) return { kind: 'confirm', candidate: strong[0] }
  return { kind: 'choose', candidates: linkable }                    // ambigüedad → selección humana
}

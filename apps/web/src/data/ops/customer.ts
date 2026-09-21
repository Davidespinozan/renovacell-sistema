// Customer domain (identidad comercial, separada de Auth) — helpers PUROS (sin red).
// Preparan identidad e idempotencia para la importación incremental; NO hacen matching semántico.
import type { Database } from '../database.types'

export type Customer = Database['public']['Tables']['customers']['Row']
export type CustomerInput = Database['public']['Tables']['customers']['Insert']

// Normalización de contacto (para identidad/dedup; nunca inventa valores).
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return null
  // válido mínimo: algo@algo.algo
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}

export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[^0-9]/g, '')
  return digits.length >= 10 ? digits : null // < 10 dígitos = no confiable
}

// Huella estable de una fila de origen: base para import_hash idempotente POR FUENTE.
// Determinista: mismos datos → misma huella (no depende del orden de captura).
export function computeImportHash(fields: {
  full_name?: string | null; email?: string | null; phone?: string | null
  city?: string | null; seller_name?: string | null
}): string {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const parts = [
    norm(fields.full_name),
    normalizeEmail(fields.email) ?? '',
    normalizePhone(fields.phone) ?? '',
    norm(fields.city),
    norm(fields.seller_name),
  ]
  // hash djb2 (estable, sin dependencias); prefijo legible para depurar.
  const s = parts.join('|')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return `h${h.toString(16)}`
}

// Estado de acceso al portal, derivado SOLO de profile_id (sin consultar profiles → sin N+1).
export function portalStatus(c: Pick<Customer, 'profile_id'>): 'Con acceso al portal' | 'Sin acceso al portal' {
  return c.profile_id ? 'Con acceso al portal' : 'Sin acceso al portal'
}

// Búsqueda del directorio: tolera NULL, mayúsculas/minúsculas y espacios. Busca en nombre,
// email, teléfono (texto y solo-dígitos), ciudad y vendedor. Cadena vacía → coincide todo.
export function matchCustomer(c: Pick<Customer, 'full_name' | 'email' | 'phone' | 'city' | 'seller_name'>, query: string): boolean {
  const q = (query ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return true
  const norm = (s: string | null | undefined) => (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const digits = (s: string | null | undefined) => (s ?? '').toString().replace(/[^0-9]/g, '')
  const hay = [norm(c.full_name), norm(c.email), norm(c.phone), norm(c.city), norm(c.seller_name)].join(' ')
  const qDigits = q.replace(/[^0-9]/g, '')
  return hay.includes(norm(query).trim()) || (qDigits.length >= 3 && digits(c.phone).includes(qDigits))
}

export type ImportState = 'NUEVO' | 'YA_EXISTE' | 'ACTUALIZABLE' | 'CONFLICTO' | 'INVALIDO'

// Clasifica una fila de importación contra el customer existente (si lo hay). Reglas:
//  - sin nombre → INVALIDO
//  - no existe → NUEVO
//  - existe y todo lo que trae el import coincide (o el import no aporta nada nuevo) → YA_EXISTE
//  - existe, DB tiene campos vacíos que el import puede rellenar (y ninguno en conflicto) → ACTUALIZABLE
//  - existe y algún campo tiene valor DISTINTO en ambos → CONFLICTO (nunca sobrescribir en silencio)
export function classifyImportRow(
  incoming: { full_name?: string | null; email?: string | null; phone?: string | null; city?: string | null; country?: string | null; seller_name?: string | null },
  existing: Customer | null,
): ImportState {
  if (!(incoming.full_name ?? '').trim()) return 'INVALIDO'
  if (!existing) return 'NUEVO'
  const fields = ['email', 'phone', 'city', 'country', 'seller_name'] as const
  let canFill = false
  const same = (a: unknown, b: unknown) => (a ?? '').toString().trim().toLowerCase() === (b ?? '').toString().trim().toLowerCase()
  for (const f of fields) {
    const inc = (incoming[f] ?? '').toString().trim()
    const cur = ((existing as Record<string, unknown>)[f] ?? '').toString().trim()
    if (!inc) continue                 // el import no aporta este campo → ignora
    if (!cur) { canFill = true; continue } // DB vacío + import trae → rellenable
    if (!same(inc, cur)) return 'CONFLICTO' // ambos con valor distinto → conflicto
  }
  return canFill ? 'ACTUALIZABLE' : 'YA_EXISTE'
}

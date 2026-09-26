// Customer domain — data layer. CRUD sobre `customers` (identidad comercial, sin Auth). La RLS es
// la autoridad (admin CRUD; pos lee; doctor solo su propio customer). NO crea Auth ni invita.
// La conversión a portal es un paso APARTE (linkCustomerToProfile + invite-doctor).
import { hasSupabase, supabase } from '../../lib/supabase'
import { logAudit } from './auditStore'
import type { Customer, CustomerInput } from '../ops/customer'
import { normalizeFiscalProfile, validateFiscalProfile, type FiscalProfile } from '../ops/fiscal'

export type CustomerFields = Omit<CustomerInput, 'id' | 'created_at' | 'updated_at'>

export async function listCustomers(opts: { seller?: string; search?: string } = {}): Promise<Customer[]> {
  if (!hasSupabase) return []
  // Pagina en bloques (PostgREST tope ~1000) para traer TODO el directorio sin N+1.
  const PAGE = 1000
  const out: Customer[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('customers').select('*').eq('active', true).order('full_name', { ascending: true }).range(from, from + PAGE - 1)
    if (opts.seller) q = q.eq('seller_name', opts.seller)
    if (opts.search) q = q.ilike('full_name', `%${opts.search}%`)
    const { data, error } = await q
    if (error) { console.warn('[customers] list', error.message); break }
    const rows = (data ?? []) as Customer[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

// Alta. Correos/teléfonos duplicados SON válidos (no hay unicidad de contacto). La idempotencia
// real la da (source, external_id) o (source, import_hash) a nivel DB.
export async function createCustomer(fields: CustomerFields): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  if (!(fields.full_name ?? '').toString().trim()) return { ok: false, error: 'Falta el nombre.' }
  const { data, error } = await supabase.from('customers').insert(fields).select('id').single()
  if (error) return { ok: false, error: error.message }
  logAudit({ actor: 'Administración', action: 'Cliente creado', resource: fields.full_name })
  return { ok: true, id: data?.id }
}

export async function updateCustomer(id: string, patch: Partial<CustomerFields>): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  const { error } = await supabase.from('customers').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deactivateCustomer(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  const { error } = await supabase.from('customers').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  logAudit({ actor: 'Administración', action: 'Cliente desactivado', resource: id })
  return { ok: true }
}

// CONVERSIÓN A PORTAL (paso 3 del flujo): enlaza un customer a un profile ya creado (por
// invite-doctor). Idempotente: fijar el mismo profile dos veces es no-op; la unicidad
// `uq_customers_profile` impide que un profile quede en dos customers. NO crea Auth ni invita aquí.
export async function linkCustomerToProfile(customerId: string, profileId: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  const { error } = await supabase.from('customers').update({ profile_id: profileId, updated_at: new Date().toISOString() }).eq('id', customerId)
  if (error) return { ok: false, error: error.message }
  logAudit({ actor: 'Administración', action: 'Cliente vinculado a portal', resource: customerId })
  return { ok: true }
}

// Lee el perfil fiscal MAESTRO de un customer (customers.meta.fiscal), normalizado al canónico.
export function customerFiscal(c: { meta?: unknown } | null | undefined): FiscalProfile {
  const f = (c?.meta as { fiscal?: unknown } | null)?.fiscal
  return normalizeFiscalProfile(f ?? {})
}

// MASTER fiscal: escribe SOLO customers.meta.fiscal vía RPC acotada (no update directo del row,
// no amplía RLS). Valida en cliente antes de invocar; el servidor revalida y autoriza.
export async function upsertCustomerFiscal(customerId: string, fiscal: FiscalProfile): Promise<{ ok: boolean; error?: string }> {
  const v = validateFiscalProfile(fiscal)
  if (!v.ok) return { ok: false, error: Object.values(v.errors)[0] ?? 'Datos fiscales incompletos.' }
  if (!hasSupabase) return { ok: true } // mock: la UI conserva el estado del formulario
  const rpc = (supabase.rpc as unknown as (fn: string, args: unknown) => Promise<{ error: { message: string } | null }>)
  const { error } = await rpc('upsert_customer_fiscal', { p_customer_id: customerId, p_fiscal: normalizeFiscalProfile(fiscal) })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// RESOLVER CENTRAL (server-side) — devuelve { status, customer_id, signals }. Solo staff puede
// llamarlo (RLS/authz en la RPC); el doctor no, para evitar enumeración de customers.
export interface IdentityResolution { status: 'EXACT' | 'MATCH' | 'NOT_FOUND' | 'AMBIGUOUS'; customer_id: string | null; signals: string[] }
export async function resolveCustomerIdentity(sig: { profile_id?: string | null; external_id?: string | null; source?: string | null; email?: string | null; phone?: string | null; name?: string | null }): Promise<IdentityResolution | null> {
  if (!hasSupabase) return null
  const rpc = (supabase.rpc as unknown as (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>)
  const { data, error } = await rpc('resolve_customer_identity', {
    p_profile_id: sig.profile_id ?? null, p_external_id: sig.external_id ?? null, p_source: sig.source ?? null,
    p_email: sig.email ?? null, p_phone: sig.phone ?? null, p_name: sig.name ?? null,
  })
  if (error) { console.warn('[identity] resolve', error.message); return null }
  return (data ?? null) as IdentityResolution | null
}

// SYNC de contacto acotado (Mi Perfil del doctor / staff). Merge conservador server-side: un valor
// vacío NUNCA pisa dato bueno. No abre UPDATE general de customers.
export async function upsertCustomerContact(customerId: string, patch: { full_name?: string; email?: string; phone?: string; city?: string; organization?: string; notes?: string; seller_name?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: true }
  const rpc = (supabase.rpc as unknown as (fn: string, args: unknown) => Promise<{ error: { message: string } | null }>)
  const { error } = await rpc('upsert_customer_contact', { p_customer_id: customerId, p_patch: patch })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Busca un customer existente por identidad (para clasificación de import). Prioridad: (source,
// external_id) → email normalizado → sin match. No usa nombre solo.
export async function findCustomerByIdentity(id: { source?: string; external_id?: string | null; email?: string | null }): Promise<Customer | null> {
  if (!hasSupabase) return null
  if (id.source && id.external_id) {
    const { data } = await supabase.from('customers').select('*').eq('source', id.source).eq('external_id', id.external_id).maybeSingle()
    if (data) return data as Customer
  }
  const email = (id.email ?? '').trim().toLowerCase()
  if (email) {
    const { data } = await supabase.from('customers').select('*').eq('email', email).limit(1).maybeSingle()
    if (data) return data as Customer
  }
  return null
}

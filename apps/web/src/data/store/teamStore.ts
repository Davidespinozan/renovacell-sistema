// EQUIPO / USUARIOS (gobernado por Administración). Admin da de alta usuarios,
// asigna su rol base y prende/apaga capabilities (responsabilidades). Es la fuente
// de verdad de las capabilities: el login las lee de aquí (mock) o de
// profiles.meta.capabilities (backend, vía supabaseAuth/has_cap). Con backend
// hidrata de `profiles` (staff = role_id<>'doctor'; RLS: admin ve/edita todo) y
// toggleCapability/setActive escriben write-through a profiles.meta. El alta de
// usuario crea un usuario de auth (server-side): queda LOCAL hasta el flujo de
// invitación (Edge Function), igual que el alta de doctores.
import type { RoleKey, CapabilityKey } from '../../app/roles'
import { MOCK_ACCOUNTS } from '../mock/accounts'
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { ROLE_MAP } from '../../auth/supabaseAuth'
import { makeLive } from './live'
import type { Json } from '../database.types'

export interface TeamUser {
  id: string
  name: string
  email: string
  role: RoleKey
  capabilities: CapabilityKey[]
  active: boolean
}

const isUuid = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

// Staff mock (los doctores se gobiernan aparte: auto-registro + verificación).
const FALLBACK: TeamUser[] = MOCK_ACCOUNTS
  .filter((a) => a.role !== 'doctor')
  .map((a, i) => ({ id: `u-${i + 1}`, name: a.name, email: a.email, role: a.role, capabilities: [...a.capabilities], active: true }))

// Cache del meta crudo por perfil, para MERGE al escribir (no pisar meta.name).
const rawMeta = new Map<string, Record<string, unknown>>()

const live = makeLive<TeamUser>(async () => {
  const { data, error } = await supabase.from('profiles')
    .select('id, email, full_name, role_id, meta')
    .neq('role_id', 'doctor')
    .order('full_name')
  if (error) throw error
  rawMeta.clear()
  return (data ?? []).map((p) => {
    const meta = (p.meta ?? {}) as { capabilities?: string[]; name?: string; active?: boolean }
    rawMeta.set(p.id, meta as Record<string, unknown>)
    return {
      id: p.id, email: p.email ?? '', name: meta.name ?? p.full_name ?? p.email ?? 'Usuario',
      role: ROLE_MAP[p.role_id ?? 'admin'] ?? 'admin',
      capabilities: (meta.capabilities ?? []) as CapabilityKey[],
      active: meta.active ?? true,
    }
  })
}, FALLBACK)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

// Escribe meta merge-ando con lo existente (preserva name y demás claves).
function writeMeta(id: string, patch: Record<string, unknown>) {
  if (!hasSupabase || !isUuid(id)) return
  const merged = { ...(rawMeta.get(id) ?? {}), ...patch }
  rawMeta.set(id, merged)
  supabase.from('profiles').update({ meta: merged as unknown as Json }).eq('id', id)
    .then(({ error }) => { if (error) console.warn('[team] meta', error.message); live.reload() })
}

// El login lee capabilities de aquí (refleja lo que Admin haya asignado).
export function capabilitiesOf(email: string): CapabilityKey[] {
  return live.current().find((u) => u.email.toLowerCase() === email.toLowerCase())?.capabilities ?? []
}
export function isActive(email: string): boolean {
  const u = live.current().find((x) => x.email.toLowerCase() === email.toLowerCase())
  return u ? u.active : true // doctores y otros no-staff: no aplican aquí
}
// Fuente de verdad del staff (existencia + rol + capabilities + activo) para el login.
export function userByEmail(email: string): TeamUser | undefined {
  return live.current().find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
}

// Helper: invoca la Edge Function `staff-admin` (crear/editar/eliminar/contraseña).
async function callStaffAdmin(payload: Record<string, unknown>): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('staff-admin', { body: payload })
  if (error) {
    // La función devuelve el detalle del error en el cuerpo; intenta leerlo.
    let msg = error.message
    try { const ctx = (error as { context?: Response }).context; if (ctx) msg = ((await ctx.json()) as { error?: string }).error ?? msg } catch { /* ignore */ }
    return { ok: false, error: msg }
  }
  const d = (data ?? {}) as { ok?: boolean; id?: string; error?: string }
  return d.error ? { ok: false, error: d.error } : { ok: true, id: d.id }
}

// ALTA de usuario. El correo lo elige Administración; la contraseña la fija aquí
// (mínimo 6). Con backend, la Edge Function crea el usuario de auth REAL y persiste
// su perfil (rol + capabilities). Sin backend, alta local (demo).
export async function addUser(input: { name: string; role: RoleKey; email: string; password: string; capabilities?: CapabilityKey[] }): Promise<{ ok: boolean; error?: string }> {
  const email = input.email.trim().toLowerCase()
  if (!email) return { ok: false, error: 'Falta el correo.' }
  if ((input.password ?? '').length < 6) return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' }
  if (live.current().some((u) => u.email.toLowerCase() === email)) return { ok: false, error: 'Ya existe un usuario con ese correo.' }
  if (hasSupabase) {
    const r = await callStaffAdmin({ action: 'create', email, password: input.password, full_name: input.name, role: input.role, capabilities: input.capabilities ?? [] })
    if (!r.ok) return { ok: false, error: r.error }
    logAudit({ actor: 'Administración', action: 'Usuario dado de alta', resource: `${input.name} · ${email}` })
    await live.reload()
    return { ok: true }
  }
  const u: TeamUser = { id: `u-new-${Date.now()}`, name: input.name, email, role: input.role, capabilities: input.capabilities ?? [], active: true }
  live.setLocal([u, ...live.current()])
  logAudit({ actor: 'Administración', action: 'Usuario dado de alta', resource: `${input.name} · ${email}` })
  return { ok: true }
}

// EDITAR nombre y/o rol de un usuario.
export async function updateUser(id: string, patch: { name?: string; role?: RoleKey }): Promise<{ ok: boolean; error?: string }> {
  const cur = live.current().find((u) => u.id === id)
  if (!cur) return { ok: false, error: 'Usuario no encontrado.' }
  live.setLocal(live.current().map((u) => (u.id === id ? { ...u, name: patch.name ?? u.name, role: patch.role ?? u.role } : u)))
  logAudit({ actor: 'Administración', action: 'Usuario editado', resource: patch.name ?? cur.name })
  if (hasSupabase && isUuid(id)) {
    const r = await callStaffAdmin({ action: 'update', id, full_name: patch.name, role: patch.role })
    if (!r.ok) { await live.reload(); return { ok: false, error: r.error } }
    await live.reload()
  }
  return { ok: true }
}

// ELIMINAR un usuario (borra su cuenta de auth).
export async function removeUser(id: string): Promise<{ ok: boolean; error?: string }> {
  const cur = live.current().find((u) => u.id === id)
  live.setLocal(live.current().filter((u) => u.id !== id))
  logAudit({ actor: 'Administración', action: 'Usuario eliminado', resource: cur?.name ?? id })
  if (hasSupabase && isUuid(id)) {
    const r = await callStaffAdmin({ action: 'delete', id })
    if (!r.ok) { await live.reload(); return { ok: false, error: r.error } }
    await live.reload()
  }
  return { ok: true }
}

// FIJAR una nueva contraseña (Administración se la comunica al usuario).
export async function setPassword(id: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if ((password ?? '').length < 6) return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' }
  const cur = live.current().find((u) => u.id === id)
  if (hasSupabase && isUuid(id)) {
    const r = await callStaffAdmin({ action: 'setPassword', id, password })
    if (!r.ok) return { ok: false, error: r.error }
  }
  logAudit({ actor: 'Administración', action: 'Contraseña restablecida', resource: cur?.name ?? id })
  return { ok: true }
}

// Sugerencia de correo de empresa a partir del nombre (el admin la puede editar).
export function suggestCompanyEmail(name: string): string {
  const parts = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  const handle = parts.length === 1 ? parts[0] : `${parts[0]}.${parts[parts.length - 1]}`
  return `${handle}@renovacell.mx`
}

export function toggleCapability(id: string, cap: CapabilityKey) {
  const cur = live.current().find((u) => u.id === id)
  if (!cur) return
  const has = cur.capabilities.includes(cap)
  const capabilities = has ? cur.capabilities.filter((c) => c !== cap) : [...cur.capabilities, cap]
  live.setLocal(live.current().map((u) => (u.id === id ? { ...u, capabilities } : u)))
  logAudit({ actor: 'Administración', action: has ? 'Capability retirada' : 'Capability asignada', resource: cur.name, detail: cap })
  writeMeta(id, { capabilities })
}

export function setActive(id: string, active: boolean) {
  const cur = live.current().find((u) => u.id === id)
  if (!cur) return
  live.setLocal(live.current().map((u) => (u.id === id ? { ...u, active } : u)))
  logAudit({ actor: 'Administración', action: active ? 'Acceso reactivado' : 'Acceso suspendido', resource: cur.name })
  writeMeta(id, { active })
}

// EQUIPO / USUARIOS (gobernado por Administración). Admin da de alta usuarios,
// asigna su rol base y prende/apaga capabilities (responsabilidades). Es la fuente
// de verdad de las capabilities: el login las lee de aquí, así que un cambio del
// Admin se refleja al entrar. Mock hoy; con Supabase = profiles + user_capabilities.
import type { RoleKey, CapabilityKey } from '../../app/roles'
import { MOCK_ACCOUNTS } from '../mock/accounts'
import { logAudit } from './auditStore'

export interface TeamUser {
  id: string
  name: string
  email: string
  role: RoleKey
  capabilities: CapabilityKey[]
  active: boolean
}

// Staff (los doctores se gobiernan aparte: auto-registro + verificación).
let users: TeamUser[] = MOCK_ACCOUNTS
  .filter((a) => a.role !== 'doctor')
  .map((a, i) => ({ id: `u-${i + 1}`, name: a.name, email: a.email, role: a.role, capabilities: [...a.capabilities], active: true }))

let seq = users.length
const listeners = new Set<() => void>()
let snapshot: TeamUser[] = [...users]

function emit() { snapshot = [...users]; listeners.forEach((l) => l()) }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }
export const getSnapshot = (): TeamUser[] => snapshot

// El login lee capabilities de aquí (refleja lo que Admin haya asignado).
export function capabilitiesOf(email: string): CapabilityKey[] {
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.capabilities ?? []
}
export function isActive(email: string): boolean {
  const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase())
  return u ? u.active : true // doctores y otros no-staff: no aplican aquí
}
// Fuente de verdad del staff (existencia + rol + capabilities + activo) para el login.
export function userByEmail(email: string): TeamUser | undefined {
  return users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
}

export function addUser(input: { name: string; role: RoleKey }): TeamUser {
  seq += 1
  const handle = input.name.split('·')[0].trim().split(/\s+/)[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const u: TeamUser = { id: `u-${seq}`, name: input.name, email: `${handle || 'usuario'}${seq}@renovacell.mx`, role: input.role, capabilities: [], active: true }
  users = [u, ...users]
  emit()
  logAudit({ actor: 'Administración', action: 'Usuario dado de alta', resource: input.name })
  return u
}

export function toggleCapability(id: string, cap: CapabilityKey) {
  let action = ''
  let who = ''
  users = users.map((u) => {
    if (u.id !== id) return u
    who = u.name
    const has = u.capabilities.includes(cap)
    action = has ? 'Capability retirada' : 'Capability asignada'
    return { ...u, capabilities: has ? u.capabilities.filter((c) => c !== cap) : [...u.capabilities, cap] }
  })
  emit()
  if (action) logAudit({ actor: 'Administración', action, resource: who, detail: cap })
}

export function setActive(id: string, active: boolean) {
  let who = ''
  users = users.map((u) => (u.id === id ? (who = u.name, { ...u, active }) : u))
  emit()
  logAudit({ actor: 'Administración', action: active ? 'Acceso reactivado' : 'Acceso suspendido', resource: who })
}

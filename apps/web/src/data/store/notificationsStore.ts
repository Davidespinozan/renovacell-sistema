// Notificaciones automáticas internas (prioridad Alta + Regla 2). Los stores
// emiten un evento cuando algo cambia (pedido nuevo, surtido, en camino,
// entregado, CFDI, cobro, prospecto, doctor) y el sistema avisa al rol que tiene
// el siguiente pendiente. Mock hoy; con Supabase = realtime (postgres_changes).
import type { RoleKey } from '../../app/roles'

export interface Notif {
  id: string
  text: string
  at: string
  roles?: RoleKey[] // audiencia; admin ve todo. undefined = broadcast
  screen?: string   // pendiente: a dónde ir a resolverlo
  read: boolean
}

let seq = 0
const listeners = new Set<() => void>()

// Seeds alineados con el estado inicial (hay doctores sin verificar y pedidos por
// surtir en los mocks) — no inventan eventos falsos.
let items: Notif[] = [
  { id: 'n-seed-2', text: 'Pedidos pendientes de surtir en Almacén', at: '2026-06-18T16:00:00.000Z', roles: ['warehouse'], screen: 'surtido', read: false },
  { id: 'n-seed-1', text: 'Doctores esperando verificación', at: '2026-06-18T17:30:00.000Z', roles: ['admin'], screen: 'av_doc', read: false },
]
let snapshot: Notif[] = [...items]

function emit() {
  snapshot = [...items]
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): Notif[] => snapshot

// Emitido por los stores en cada transición. `at` se sella aquí.
export function notify(input: { text: string; roles?: RoleKey[]; screen?: string }) {
  seq += 1
  const n: Notif = { id: `n-${seq}`, text: input.text, at: new Date().toISOString(), roles: input.roles, screen: input.screen, read: false }
  items = [n, ...items]
  emit()
}

export function markAllRead(visibleIds: string[]) {
  const set = new Set(visibleIds)
  items = items.map((n) => (set.has(n.id) ? { ...n, read: true } : n))
  emit()
}
export function markRead(id: string) {
  items = items.map((n) => (n.id === id ? { ...n, read: true } : n))
  emit()
}

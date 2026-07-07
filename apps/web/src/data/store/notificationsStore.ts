// Notificaciones automáticas internas (prioridad Alta + Regla 2). Los stores
// emiten un evento en cada transición (pedido nuevo, surtido, en camino, entregado,
// CFDI, cobro, prospecto, doctor) dirigido al rol que tiene el siguiente pendiente.
// Con backend (hasSupabase): notify() inserta en `notifications` (RLS acota la
// audiencia por rol; los doctores no reciben nada) y el aviso llega EN VIVO por
// Realtime; el "leído" es POR USUARIO (`notification_reads`). Sin backend, mock.
import type { RoleKey } from '../../app/roles'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'

export interface Notif {
  id: string
  text: string
  at: string
  roles?: RoleKey[] // audiencia; admin ve todo. undefined = broadcast
  screen?: string   // pendiente: a dónde ir a resolverlo
  read: boolean
}

const uuid = (): string => (globalThis.crypto?.randomUUID?.() ?? `n-${Math.random().toString(16).slice(2)}`)
let seq = 0
const listeners = new Set<() => void>()

// Seeds SOLO para modo mock (sin backend).
const SEED: Notif[] = [
  { id: 'n-seed-2', text: 'Pedidos pendientes de surtir en Almacén', at: '2026-06-18T16:00:00.000Z', roles: ['warehouse'], screen: 'surtido', read: false },
  { id: 'n-seed-1', text: 'Doctores esperando verificación', at: '2026-06-18T17:30:00.000Z', roles: ['admin'], screen: 'av_doc', read: false },
]

let items: Notif[] = hasSupabase ? [] : [...SEED]
let snapshot: Notif[] = [...items]
const readSet = new Set<string>() // ids leídos por el usuario en sesión

function emit() {
  snapshot = [...items]
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): Notif[] => snapshot

// ---- Hidratación + Realtime (solo con backend) ----
async function hydrate() {
  if (!hasSupabase) return
  const [{ data: notis, error: ne }, { data: reads }] = await Promise.all([
    supabase.from('notifications').select('id, body, roles, screen, created_at').order('created_at', { ascending: false }).limit(100),
    supabase.from('notification_reads').select('notification_id'),
  ])
  if (ne) { console.warn('[notif] hydrate', ne.message); return }
  readSet.clear()
  ;(reads ?? []).forEach((r) => readSet.add(r.notification_id))
  items = (notis ?? []).map((n) => ({
    id: n.id, text: n.body, at: n.created_at ?? '', roles: (n.roles ?? undefined) as RoleKey[] | undefined,
    screen: n.screen ?? undefined, read: readSet.has(n.id),
  }))
  emit()
}

// Realtime necesita el TOKEN del usuario (si va con anon key el RLS filtra todo).
let notifChannel: ReturnType<typeof supabase.channel> | null = null
async function ensureRealtime() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return
  supabase.realtime.setAuth(token)
  if (notifChannel) return
  notifChannel = supabase.channel('rc-notif')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
      const n = payload.new as { id: string; body: string; roles: string[] | null; screen: string | null; created_at: string }
      if (items.some((x) => x.id === n.id)) return
      items = [{ id: n.id, text: n.body, at: n.created_at, roles: (n.roles ?? undefined) as RoleKey[] | undefined, screen: n.screen ?? undefined, read: false }, ...items]
      emit()
    })
    .subscribe()
}

if (hasSupabase) {
  hydrate()
  ensureRealtime()
  supabase.auth.onAuthStateChange((ev) => {
    if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'TOKEN_REFRESHED') { hydrate(); ensureRealtime() }
    else if (ev === 'SIGNED_OUT') { items = []; readSet.clear(); emit() }
  })
}

// Emitido por los stores en cada transición. Con backend inserta y deja que el
// Realtime lo entregue a la audiencia correcta (no se agrega optimista local: el
// emisor no siempre es audiencia, y si lo es le llega por Realtime).
export function notify(input: { text: string; roles?: RoleKey[]; screen?: string }) {
  if (hasSupabase) {
    supabase.from('notifications').insert({ id: uuid(), body: input.text, roles: input.roles ?? null, screen: input.screen ?? null, created_by: currentUserId() })
      .then(({ error }) => { if (error) console.warn('[notif] insert', error.message) })
    return
  }
  seq += 1
  items = [{ id: `n-${seq}`, text: input.text, at: new Date().toISOString(), roles: input.roles, screen: input.screen, read: false }, ...items]
  emit()
}

export function markAllRead(visibleIds: string[]) {
  const set = new Set(visibleIds)
  items = items.map((n) => (set.has(n.id) ? { ...n, read: true } : n))
  emit()
  if (hasSupabase) {
    const uid = currentUserId()
    if (uid && visibleIds.length) supabase.from('notification_reads').upsert(visibleIds.map((id) => ({ notification_id: id, user_id: uid }))).then(({ error }) => { if (error) console.warn('[notif] read-all', error.message) })
  }
}
export function markRead(id: string) {
  items = items.map((n) => (n.id === id ? { ...n, read: true } : n))
  emit()
  if (hasSupabase) {
    const uid = currentUserId()
    if (uid) supabase.from('notification_reads').upsert({ notification_id: id, user_id: uid }).then(({ error }) => { if (error) console.warn('[notif] read', error.message) })
  }
}

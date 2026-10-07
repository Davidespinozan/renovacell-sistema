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
  roles?: RoleKey[] // audiencia por rol; admin ve todo. undefined = broadcast
  // Destinatarios explícitos (personas). Si viene, MANDA sobre `roles`: solo ellos
  // la ven. Se usa para avisos de chat, donde la audiencia son los miembros de la
  // conversación y no un rol — y donde un directo debe permanecer privado.
  userIds?: string[]
  screen?: string   // pendiente: a dónde ir a resolverlo
  read: boolean
  // CHV2-A/B · aviso estructurado (comercial): tipo, conversación referida e identidad del evento.
  // Son una SEÑAL: el estado real se vuelve a leer del servidor (cola/pendientes) antes de actuar.
  kind?: string
  conversationId?: string
  eventKey?: string
}

const uuid = (): string => (globalThis.crypto?.randomUUID?.() ?? `n-${Math.random().toString(16).slice(2)}`)
let seq = 0
const listeners = new Set<() => void>()

// Seeds SOLO para modo mock (sin backend).
const SEED: Notif[] = [
  { id: 'n-seed-2', text: 'Pedidos pendientes de surtir en Almacén', at: '2026-06-18T16:00:00.000Z', roles: ['warehouse'], screen: 'surtido', read: false },
  { id: 'n-seed-1', text: 'Doctores esperando verificación', at: '2026-06-18T17:30:00.000Z', roles: ['admin'], screen: 'av_verif', read: false },
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

// CHV2-B · Señal de aviso NUEVO en vivo (Realtime INSERT). La hidratación nunca la dispara: al recargar
// la página no "revive" alertas viejas; lo pendiente sigue en Inicio/Mi bandeja (estado del servidor).
const nuevas = new Set<(n: Notif) => void>()
export function onNuevaNotificacion(cb: (n: Notif) => void): () => void {
  nuevas.add(cb)
  return () => { nuevas.delete(cb) }
}
function senalar(n: Notif) { nuevas.forEach((cb) => { try { cb(n) } catch (e) { console.warn('[notif] señal', e) } }) }

type FilaNotif = { id: string; body: string; roles: string[] | null; user_ids: string[] | null; screen: string | null; created_at: string | null; kind?: string | null; conversation_id?: string | null; event_key?: string | null }
export function aNotif(n: FilaNotif, read: boolean): Notif {
  return {
    id: n.id, text: n.body, at: n.created_at ?? '', roles: (n.roles ?? undefined) as RoleKey[] | undefined, userIds: (n.user_ids ?? undefined) as string[] | undefined,
    screen: n.screen ?? undefined, read, kind: n.kind ?? undefined, conversationId: n.conversation_id ?? undefined, eventKey: n.event_key ?? undefined,
  }
}

// ---- Hidratación + Realtime (solo con backend) ----
async function hydrate() {
  if (!hasSupabase) return
  const [{ data: notis, error: ne }, { data: reads }] = await Promise.all([
    supabase.from('notifications').select('id, body, roles, user_ids, screen, created_at, kind, conversation_id, event_key').order('created_at', { ascending: false }).limit(100),
    supabase.from('notification_reads').select('notification_id'),
  ])
  if (ne) { console.warn('[notif] hydrate', ne.message); return }
  readSet.clear()
  ;(reads ?? []).forEach((r) => readSet.add(r.notification_id))
  items = (notis ?? []).map((n) => aNotif(n, readSet.has(n.id)))
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
      const n = payload.new as FilaNotif
      if (items.some((x) => x.id === n.id)) return
      const nueva = aNotif(n, false)
      items = [nueva, ...items]
      emit()
      senalar(nueva)
    })
    .subscribe()
}

// `?.` y catch a propósito: en pruebas el cliente puede estar simulado sin `auth`/`from` (como live.ts).
if (hasSupabase && supabase.auth) {
  hydrate().catch((e) => console.warn('[notif] hydrate', e))
  ensureRealtime().catch((e) => console.warn('[notif] realtime', e))
  supabase.auth.onAuthStateChange?.((ev) => {
    if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'TOKEN_REFRESHED') { hydrate(); ensureRealtime() }
    else if (ev === 'SIGNED_OUT') { items = []; readSet.clear(); emit() }
  })
}

// W4 · CLASE D (deliberado): un aviso interno que no se pudo emitir NO se muestra como
// fallo al operador — quien emite casi nunca es el destinatario, y lo que requiere
// acción ya no depende de estos avisos: las bandejas se derivan del estado del servidor.
// CHV2-B · Solo pruebas / vista previa local: simula la llegada en vivo de un aviso ya existente en el
// servidor (misma ruta que el INSERT de Realtime). No escribe nada.
export function _simularLlegada(n: Notif) { if (items.some((x) => x.id === n.id)) return; items = [n, ...items]; emit(); senalar(n) }

// Emitido por los stores en cada transición. Con backend inserta y deja que el
// Realtime lo entregue a la audiencia correcta (no se agrega optimista local: el
// emisor no siempre es audiencia, y si lo es le llega por Realtime).
export function notify(input: { text: string; roles?: RoleKey[]; screen?: string; userIds?: string[] }) {
  if (hasSupabase) {
    supabase.from('notifications').insert({ id: uuid(), body: input.text, roles: input.roles ?? null, user_ids: input.userIds ?? null, screen: input.screen ?? null, created_by: currentUserId() })
      .then(({ error }) => { if (error) console.warn('[notif] insert', error.message) })
    return
  }
  seq += 1
  const nueva: Notif = { id: `n-${seq}`, text: input.text, at: new Date().toISOString(), roles: input.roles, userIds: input.userIds, screen: input.screen, read: false }
  items = [nueva, ...items]
  emit()
  senalar(nueva)
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

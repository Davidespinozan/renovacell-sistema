// Chat interno de staff. Con backend (hasSupabase) hidrata de `conversations` y
// `messages` (RLS: solo staff; DM propio o grupo de tu área; los DOCTORES no ven
// nada) y recibe mensajes EN VIVO por Supabase Realtime (postgres_changes). Las
// mutaciones escriben write-through (optimista + insert; el eco de Realtime se
// deduplica por id). Sin backend, opera sobre el mock. El hook useChat no cambia.
import type { Conversation, Message } from '../types'
import { CURRENT_USER as MOCK_ME, MOCK_CONVERSATIONS, MOCK_MESSAGES } from '../mock/chat'
import { isStaffUser } from '../mock/users'
import { getSnapshot as teamSnapshot } from './teamStore'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'

const uuid = (): string => (globalThis.crypto?.randomUUID?.() ?? `c-${Math.random().toString(16).slice(2)}`)
const isUuid = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

// Usuario en sesión del chat. Se SINCRONIZA con la sesión real (id = auth.uid(),
// nombre = perfil del usuario logueado) vía setCurrentUser(), que llama useChat en
// cada render. Antes tomaba un nombre genérico ("Tú") y a veces el id no coincidía,
// por eso los mensajes salían sin distinguir al remitente.
export const CURRENT_USER = {
  id: hasSupabase ? (currentUserId() ?? 'me') : MOCK_ME.id,
  name: MOCK_ME.name,
}

// Atado a la sesión: el hook lo actualiza con el usuario realmente logueado.
export function setCurrentUser(u: { id?: string | null; name?: string | null }) {
  if (u.id) CURRENT_USER.id = u.id
  if (u.name) CURRENT_USER.name = u.name
}

let conversations: Conversation[] = hasSupabase ? [] : [...MOCK_CONVERSATIONS]
let messages: Record<string, Message[]> = hasSupabase ? {} : { ...MOCK_MESSAGES }
let seq = 9000

const listeners = new Set<() => void>()

// Nombre del otro miembro de un DM (para el título, correcto para AMBOS lados).
function dmTitle(conv: Conversation): string | null {
  if (conv.kind !== 'dm') return conv.title
  const me = CURRENT_USER.id
  const otherId = conv.member_ids.find((m) => m !== me)
  const other = teamSnapshot().find((u) => u.id === otherId)
  return other?.name ?? conv.title
}

function sortedConvs(): Conversation[] {
  return [...conversations]
    .map((c) => (c.kind === 'dm' && hasSupabase ? { ...c, title: dmTitle(c) } : c))
    .sort((a, b) => {
      const ta = a.last_message_at ?? a.created_at
      const tb = b.last_message_at ?? b.created_at
      return ta < tb ? 1 : -1
    })
}

let snapConvs = sortedConvs()
let snapMsgs = messages

function emit() {
  snapConvs = sortedConvs()
  snapMsgs = { ...messages }
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getConversations = (): Conversation[] => snapConvs
export const getMessages = (): Record<string, Message[]> => snapMsgs

// ---- Hidratación + Realtime (solo con backend) ----
async function hydrate() {
  if (!hasSupabase) return
  CURRENT_USER.id = currentUserId() ?? CURRENT_USER.id
  const me = teamSnapshot().find((u) => u.id === CURRENT_USER.id)
  if (me) CURRENT_USER.name = me.name
  const [{ data: convs, error: ce }, { data: msgs, error: me2 }] = await Promise.all([
    supabase.from('conversations').select('id, kind, title, area, member_ids, created_at, last_message_at'),
    supabase.from('messages').select('id, conversation_id, sender_id, sender_name, body, created_at').order('created_at', { ascending: true }),
  ])
  if (ce || me2) { console.warn('[chat] hydrate', ce?.message ?? me2?.message); return }
  conversations = (convs ?? []) as unknown as Conversation[]
  const map: Record<string, Message[]> = {}
  ;(msgs ?? []).forEach((m) => { (map[m.conversation_id] ??= []).push(m as unknown as Message) })
  messages = map
  emit()
}

function pushRealtime(m: Message) {
  const arr = messages[m.conversation_id] ?? []
  if (arr.some((x) => x.id === m.id)) return // ya está (eco de mi propio envío)
  messages = { ...messages, [m.conversation_id]: [...arr, m] }
  conversations = conversations.map((c) => (c.id === m.conversation_id ? { ...c, last_message_at: m.created_at } : c))
  emit()
}

// Quita un mensaje por id (borrado en vivo desde otro cliente o el propio).
function removeMessageLocal(id: string) {
  let changed = false
  const next: Record<string, Message[]> = {}
  for (const [conv, arr] of Object.entries(messages)) {
    const filtered = arr.filter((x) => x.id !== id)
    if (filtered.length !== arr.length) changed = true
    next[conv] = filtered
  }
  if (changed) { messages = next; emit() }
}

// Realtime: el postgres_changes sobre tablas con RLS necesita el TOKEN del usuario
// (si el socket va con la anon key, el RLS filtra todo y no llegan eventos). Por eso
// hacemos realtime.setAuth(token) antes de suscribir y en cada refresh de token.
let chatChannel: ReturnType<typeof supabase.channel> | null = null
async function ensureRealtime() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return
  supabase.realtime.setAuth(token)
  if (chatChannel) return
  chatChannel = supabase.channel('rc-chat')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => pushRealtime(payload.new as unknown as Message))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => { const id = (payload.old as { id?: string })?.id; if (id) removeMessageLocal(id) })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, () => hydrate())
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conversations' }, () => hydrate())
    .subscribe()
}

if (hasSupabase) {
  hydrate()
  ensureRealtime()
  supabase.auth.onAuthStateChange((ev) => {
    if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'TOKEN_REFRESHED') { hydrate(); ensureRealtime() }
    else if (ev === 'SIGNED_OUT') { conversations = []; messages = {}; emit() }
  })
}

export function sendMessage(conversationId: string, body: string) {
  const trimmed = body.trim()
  if (!trimmed) return
  seq += 1
  const now = new Date().toISOString()
  const senderId = hasSupabase ? (currentUserId() ?? CURRENT_USER.id) : CURRENT_USER.id
  const id = hasSupabase ? uuid() : `m-${seq}`
  const msg: Message = {
    id, conversation_id: conversationId, sender_id: senderId,
    sender_name: CURRENT_USER.name, body: trimmed, created_at: now,
  }
  messages = { ...messages, [conversationId]: [...(messages[conversationId] ?? []), msg] }
  conversations = conversations.map((c) => (c.id === conversationId ? { ...c, last_message_at: now } : c))
  emit()
  if (hasSupabase) {
    supabase.from('messages').insert({ id, conversation_id: conversationId, sender_id: senderId, sender_name: CURRENT_USER.name, body: trimmed })
      .then(({ error }) => {
        // Si el envío falla (RLS/red), quita el mensaje optimista (no fingir envío).
        if (error) { console.warn('[chat] send', error.message); messages = { ...messages, [conversationId]: (messages[conversationId] ?? []).filter((x) => x.id !== id) }; emit() }
      })
  }
}

// Abre el DM con un usuario; si no existe, lo crea. Devuelve el id o null.
// DEFENSA: solo DMs con STAFF (lo garantizan el directorio staff + la RLS).
export function ensureDirect(user: { id: string; name: string }): string | null {
  if (hasSupabase) {
    const me = currentUserId()
    if (!me) return null
    const existing = conversations.find((c) => c.kind === 'dm' && c.member_ids.includes(user.id) && c.member_ids.includes(me))
    if (existing) return existing.id
    const id = uuid()
    const now = new Date().toISOString()
    const conv: Conversation = { id, kind: 'dm', title: user.name, area: null, member_ids: [me, user.id], created_at: now, last_message_at: now }
    conversations = [conv, ...conversations]
    if (!messages[id]) messages = { ...messages, [id]: [] }
    emit()
    supabase.from('conversations').insert({ id, kind: 'dm', title: user.name, member_ids: [me, user.id] })
      .then(({ error }) => { if (error) console.warn('[chat] dm', error.message); hydrate() })
    return id
  }
  // ---- mock ----
  if (!isStaffUser(user.id)) return null
  const existing = conversations.find((c) => c.kind === 'dm' && c.member_ids.includes(user.id))
  if (existing) return existing.id
  seq += 1
  const id = `dm-${seq}`
  const now = new Date().toISOString()
  const conv: Conversation = { id, kind: 'dm', title: user.name, area: null, member_ids: [CURRENT_USER.id, user.id], created_at: now, last_message_at: now }
  conversations = [conv, ...conversations]
  if (!messages[id]) messages = { ...messages, [id]: [] }
  emit()
  return id
}

// Borra un mensaje (el RLS permite el propio; admin cualquiera).
export function deleteMessage(conversationId: string, messageId: string) {
  messages = { ...messages, [conversationId]: (messages[conversationId] ?? []).filter((m) => m.id !== messageId) }
  emit()
  if (hasSupabase && isUuid(messageId)) supabase.from('messages').delete().eq('id', messageId).then(({ error }) => { if (error) console.warn('[chat] del msg', error.message) })
}

// Borra una conversación completa (DM: cualquier miembro; grupo: solo admin).
// Los mensajes caen por ON DELETE CASCADE.
export function deleteConversation(conversationId: string) {
  conversations = conversations.filter((c) => c.id !== conversationId)
  const { [conversationId]: _drop, ...rest } = messages
  messages = rest
  emit()
  if (hasSupabase && isUuid(conversationId)) supabase.from('conversations').delete().eq('id', conversationId).then(({ error }) => { if (error) console.warn('[chat] del conv', error.message) })
}

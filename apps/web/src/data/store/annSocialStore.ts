// Interacción social de ANUNCIOS: comentarios, reacciones ("Me sirve") y acuse de
// lectura, PERSISTENTES por usuario (antes eran solo estado local). Hidrata de
// announcement_comments/reactions/reads y escribe write-through. Sin backend, mock.
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'

export interface AnnComment { id: string; announcement_id: string; author: string; body: string; created_at: string }

const uuid = (): string => (globalThis.crypto?.randomUUID?.() ?? `c-${Math.random().toString(16).slice(2)}`)

let comments: Record<string, AnnComment[]> = {}
let reactionUsers: Record<string, string[]> = {}
let readUsers: Record<string, string[]> = {}

interface Snap { comments: Record<string, AnnComment[]>; reactionUsers: Record<string, string[]>; readUsers: Record<string, string[]> }
let snap: Snap = { comments, reactionUsers, readUsers }
const listeners = new Set<() => void>()
const emit = () => { snap = { comments, reactionUsers, readUsers }; listeners.forEach((l) => l()) }

export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb) } }
export const getSnapshot = (): Snap => snap

async function hydrate() {
  if (!hasSupabase) return
  const [c, rx, rd] = await Promise.all([
    supabase.from('announcement_comments').select('id, announcement_id, author, body, created_at').order('created_at', { ascending: true }),
    supabase.from('announcement_reactions').select('announcement_id, user_id'),
    supabase.from('announcement_reads').select('announcement_id, user_id'),
  ])
  if (c.error || rx.error || rd.error) { console.warn('[annSocial] hydrate', c.error?.message ?? rx.error?.message ?? rd.error?.message); return }
  const cm: Record<string, AnnComment[]> = {}
  ;(c.data ?? []).forEach((r) => { (cm[r.announcement_id] ??= []).push({ id: r.id, announcement_id: r.announcement_id, author: r.author ?? 'Equipo', body: r.body, created_at: r.created_at ?? '' }) })
  const rxm: Record<string, string[]> = {}
  ;(rx.data ?? []).forEach((r) => { (rxm[r.announcement_id] ??= []).push(r.user_id) })
  const rdm: Record<string, string[]> = {}
  ;(rd.data ?? []).forEach((r) => { (rdm[r.announcement_id] ??= []).push(r.user_id) })
  comments = cm; reactionUsers = rxm; readUsers = rdm
  emit()
}
if (hasSupabase) {
  hydrate()
  supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'TOKEN_REFRESHED') hydrate() })
}

export function addComment(announcementId: string, body: string, author: string) {
  const text = body.trim(); if (!text) return
  const uid = currentUserId()
  if (hasSupabase && !uid) return // sin sesión aún: no crear comentarios fantasma
  const c: AnnComment = { id: uuid(), announcement_id: announcementId, author, body: text, created_at: new Date().toISOString() }
  comments = { ...comments, [announcementId]: [...(comments[announcementId] ?? []), c] }
  emit()
  if (hasSupabase) supabase.from('announcement_comments').insert({ id: c.id, announcement_id: announcementId, user_id: uid, author, body: text })
    .then(({ error }) => { if (error) { console.warn('[annSocial] comment', error.message); comments = { ...comments, [announcementId]: (comments[announcementId] ?? []).filter((x) => x.id !== c.id) }; emit() } })
}

export function deleteComment(announcementId: string, commentId: string) {
  comments = { ...comments, [announcementId]: (comments[announcementId] ?? []).filter((c) => c.id !== commentId) }
  emit()
  if (hasSupabase) supabase.from('announcement_comments').delete().eq('id', commentId).then(({ error }) => { if (error) console.warn('[annSocial] del comment', error.message) })
}

export function toggleReaction(announcementId: string) {
  const uid = currentUserId()
  if (hasSupabase && !uid) return
  const id = uid ?? 'me'
  const cur = reactionUsers[announcementId] ?? []
  const has = cur.includes(id)
  const revert = () => { reactionUsers = { ...reactionUsers, [announcementId]: cur }; emit() }
  reactionUsers = { ...reactionUsers, [announcementId]: has ? cur.filter((u) => u !== id) : [...cur, id] }
  emit()
  if (hasSupabase) {
    const q = has
      ? supabase.from('announcement_reactions').delete().eq('announcement_id', announcementId).eq('user_id', id)
      : supabase.from('announcement_reactions').insert({ announcement_id: announcementId, user_id: id })
    q.then(({ error }) => { if (error) { console.warn('[annSocial] reaction', error.message); revert() } })
  }
}

export function markRead(announcementId: string) {
  const uid = currentUserId()
  if (hasSupabase && !uid) return
  const id = uid ?? 'me'
  const cur = readUsers[announcementId] ?? []
  if (cur.includes(id)) return
  readUsers = { ...readUsers, [announcementId]: [...cur, id] }
  emit()
  // DO NOTHING en conflicto (no DO UPDATE): la tabla solo tiene policy INSERT/SELECT,
  // no UPDATE. Ya evitamos duplicados con el early-return de arriba; ignoreDuplicates
  // cubre la carrera sin requerir permiso de UPDATE.
  if (hasSupabase) supabase.from('announcement_reads').upsert({ announcement_id: announcementId, user_id: id }, { onConflict: 'announcement_id,user_id', ignoreDuplicates: true })
    .then(({ error }) => { if (error) { console.warn('[annSocial] read', error.message); readUsers = { ...readUsers, [announcementId]: cur }; emit() } })
}

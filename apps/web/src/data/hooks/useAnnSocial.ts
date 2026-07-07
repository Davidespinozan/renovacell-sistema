// Hook de interacción social de anuncios (comentarios/reacciones/leído) persistentes.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, addComment, deleteComment, toggleReaction, markRead, type AnnComment } from '../store/annSocialStore'
import { currentUserId } from '../../lib/supabase'

export function useAnnSocial() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const me = currentUserId() ?? 'me'
  return {
    comments: (id: string): AnnComment[] => snap.comments[id] ?? [],
    reactionCount: (id: string): number => (snap.reactionUsers[id] ?? []).length,
    reacted: (id: string): boolean => (snap.reactionUsers[id] ?? []).includes(me),
    readCount: (id: string): number => (snap.readUsers[id] ?? []).length,
    read: (id: string): boolean => (snap.readUsers[id] ?? []).includes(me),
    addComment, deleteComment, toggleReaction, markRead,
  }
}

export type { AnnComment }

// Hook de anuncios/avisos. Con backend (hasSupabase) lee/escribe sobre la tabla
// `announcements` (RLS: staff lee; admin/comm o capacidad 'anuncios' gestionan).
// Sin backend, opera sobre el mock local. La vista común no cambia.
import { useCallback, useEffect, useState } from 'react'
import type { Announcement, RoleId } from '../types'
import { MOCK_ANNOUNCEMENTS } from '../mock/comunicacion'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import { useRole } from '../../auth/RoleContext'
import type { Json } from '../database.types'

export type AnnouncementKind = 'anuncio' | 'aviso'

export interface AnnouncementInput {
  title: string
  body: string
  kind: AnnouncementKind
  pinned: boolean
  audience: RoleId | null
}

function newId(prefix: string): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  return c?.randomUUID ? c.randomUUID() : `${prefix}-${Math.floor(performance.now())}`
}

export function useAnnouncements() {
  const { user } = useRole()
  const [data, setData] = useState<Announcement[]>(hasSupabase ? [] : MOCK_ANNOUNCEMENTS)
  const [loading, setLoading] = useState(hasSupabase)

  const reload = useCallback(async () => {
    if (!hasSupabase) return
    const { data: rows, error } = await supabase
      .from('announcements')
      .select('id, title, body, start_at, end_at, created_by, created_at, metadata')
      .order('created_at', { ascending: false })
    if (!error) setData((rows ?? []) as unknown as Announcement[])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (hasSupabase) reload()
    else { setData(MOCK_ANNOUNCEMENTS); setLoading(false) }
  }, [reload])

  const create = (input: AnnouncementInput) => {
    const id = newId('an')
    const now = new Date().toISOString()
    const metadata = { kind: input.kind, pinned: input.pinned, audience: input.audience, author: user?.name ?? 'Tú', reactions: 0, reads: 0 }
    const row: Announcement = { id, title: input.title, body: input.body, start_at: now, end_at: null, created_by: currentUserId(), created_at: now, metadata }
    setData((prev) => [row, ...prev])
    if (hasSupabase) {
      supabase.from('announcements').insert({ id, title: input.title, body: input.body, start_at: now, created_by: currentUserId(), metadata: metadata as unknown as Json })
        .then(({ error }) => { if (error) console.warn('[announcements] insert', error.message); reload() })
    }
  }

  const update = (id: string, input: AnnouncementInput) => {
    const cur = data.find((a) => a.id === id)
    const metadata = { ...((cur?.metadata ?? {}) as Record<string, unknown>), kind: input.kind, pinned: input.pinned, audience: input.audience }
    setData((prev) => prev.map((a) => (a.id === id ? { ...a, title: input.title, body: input.body, metadata } : a)))
    if (hasSupabase) supabase.from('announcements').update({ title: input.title, body: input.body, metadata: metadata as unknown as Json }).eq('id', id).then(({ error }) => { if (error) console.warn('[announcements] update', error.message); reload() })
  }

  const remove = (id: string) => {
    setData((prev) => prev.filter((a) => a.id !== id))
    if (hasSupabase) supabase.from('announcements').delete().eq('id', id).then(({ error }) => { if (error) console.warn('[announcements] remove', error.message); reload() })
  }

  const togglePin = (id: string) => {
    const cur = data.find((a) => a.id === id)
    const pinned = !(cur?.metadata?.pinned)
    const metadata = { ...((cur?.metadata ?? {}) as Record<string, unknown>), pinned }
    setData((prev) => prev.map((a) => (a.id === id ? { ...a, metadata } : a)))
    if (hasSupabase) supabase.from('announcements').update({ metadata: metadata as unknown as Json }).eq('id', id).then(() => reload())
  }

  return { data, loading, error: null as string | null, create, update, remove, togglePin }
}

// Hook de acceso a anuncios/avisos. HOY mock con estado local + mutadores;
// MAÑANA el cuerpo se cambia a Supabase (select/insert/update/delete sobre
// `announcements`) SIN tocar la vista común.
import { useEffect, useState } from 'react'
import type { Announcement, RoleId } from '../types'
import { MOCK_ANNOUNCEMENTS } from '../mock/comunicacion'

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
  const [data, setData] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.resolve(MOCK_ANNOUNCEMENTS).then((d) => {
      if (alive) {
        setData(d)
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const create = (input: AnnouncementInput) => {
    const row: Announcement = {
      id: newId('an'),
      title: input.title,
      body: input.body,
      start_at: new Date().toISOString(),
      end_at: null,
      created_by: null,
      created_at: new Date().toISOString(),
      metadata: { kind: input.kind, pinned: input.pinned, audience: input.audience },
    }
    setData((prev) => [row, ...prev])
  }

  const update = (id: string, input: AnnouncementInput) => {
    setData((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              title: input.title,
              body: input.body,
              metadata: { ...(a.metadata ?? {}), kind: input.kind, pinned: input.pinned, audience: input.audience },
            }
          : a,
      ),
    )
  }

  const remove = (id: string) => setData((prev) => prev.filter((a) => a.id !== id))

  const togglePin = (id: string) =>
    setData((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, metadata: { ...(a.metadata ?? {}), pinned: !(a.metadata?.pinned) } } : a,
      ),
    )

  return { data, loading, error: null as string | null, create, update, remove, togglePin }
}

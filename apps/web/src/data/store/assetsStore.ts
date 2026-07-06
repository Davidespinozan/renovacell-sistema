// Biblioteca de assets (store COMPARTIDO). Con backend hidrata de `assets` (RLS:
// staff lee; admin/comm o capacidad 'anuncios' gestionan) y create/remove escriben
// write-through. Sin backend, opera sobre el mock. (Real: + Supabase Storage.)
import type { Asset } from '../types'
import { MOCK_ASSETS } from '../mock/comunicacion'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import { makeLive } from './live'
import type { Json } from '../database.types'

export interface AssetInput { key: string; url: string; tags: string[] }

const live = makeLive<Asset>(async () => {
  const { data, error } = await supabase.from('assets')
    .select('id, key, url, uploaded_by, tags, metadata, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Asset[]
}, MOCK_ASSETS)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

let seq = 0
export function create(input: AssetInput): Asset {
  seq += 1
  const row: Asset = {
    id: hasSupabase ? (globalThis.crypto?.randomUUID?.() ?? `as-${seq}`) : `as-${seq}`,
    key: input.key, url: input.url, uploaded_by: hasSupabase ? currentUserId() : null,
    tags: input.tags, metadata: { type: 'image' }, created_at: new Date().toISOString(),
  }
  live.setLocal([row, ...live.current()])
  if (hasSupabase) {
    supabase.from('assets').insert({
      id: row.id, key: input.key, url: input.url, uploaded_by: currentUserId(),
      tags: input.tags, metadata: { type: 'image' } as unknown as Json,
    }).then(({ error }) => { if (error) console.warn('[assets] insert', error.message); live.reload() })
  }
  return row
}

export function remove(id: string) {
  live.setLocal(live.current().filter((a) => a.id !== id))
  if (hasSupabase) supabase.from('assets').delete().eq('id', id).then(({ error }) => { if (error) console.warn('[assets] remove', error.message); live.reload() })
}

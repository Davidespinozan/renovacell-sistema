// Biblioteca de assets (store COMPARTIDO) — antes era estado local por componente,
// por eso un asset subido (o un recurso entregado por Diseño) no aparecía en la
// Vista Común. Ahora es un store único. Mock; con Supabase = tabla assets + Storage.
import type { Asset } from '../types'
import { MOCK_ASSETS } from '../mock/comunicacion'

export interface AssetInput { key: string; url: string; tags: string[] }

let assets: Asset[] = [...MOCK_ASSETS]
let seq = 0
const listeners = new Set<() => void>()
let snapshot: Asset[] = [...assets]

function emit() { snapshot = [...assets]; listeners.forEach((l) => l()) }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }
export const getSnapshot = (): Asset[] => snapshot

export function create(input: AssetInput): Asset {
  seq += 1
  const row: Asset = {
    id: `as-${seq}`,
    key: input.key,
    url: input.url,
    uploaded_by: null,
    tags: input.tags,
    metadata: { type: 'image' },
    created_at: new Date().toISOString(),
  }
  assets = [row, ...assets]
  emit()
  return row
}

export function remove(id: string) {
  assets = assets.filter((a) => a.id !== id)
  emit()
}

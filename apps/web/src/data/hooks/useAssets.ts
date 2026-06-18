// Hook de acceso a la biblioteca de assets. HOY mock con estado local;
// MAÑANA se cambia a Supabase (`assets` + Storage) SIN tocar la vista común.
import { useEffect, useState } from 'react'
import type { Asset } from '../types'
import { MOCK_ASSETS } from '../mock/comunicacion'

export interface AssetInput {
  key: string
  url: string
  tags: string[]
}

function newId(prefix: string): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  return c?.randomUUID ? c.randomUUID() : `${prefix}-${Math.floor(performance.now())}`
}

export function useAssets() {
  const [data, setData] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.resolve(MOCK_ASSETS).then((d) => {
      if (alive) {
        setData(d)
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const create = (input: AssetInput) => {
    const row: Asset = {
      id: newId('as'),
      key: input.key,
      url: input.url,
      uploaded_by: null,
      tags: input.tags,
      metadata: { type: 'image' },
      created_at: new Date().toISOString(),
    }
    setData((prev) => [row, ...prev])
  }

  const remove = (id: string) => setData((prev) => prev.filter((a) => a.id !== id))

  return { data, loading, error: null as string | null, create, remove }
}

// Hook de la biblioteca de assets sobre un store COMPARTIDO (useSyncExternalStore),
// así lo que sube/edita un usuario lo ven todos y persiste durante la sesión.
// Mañana: Supabase (`assets` + Storage) sin tocar la vista.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, create, remove, type AssetInput } from '../store/assetsStore'

export function useAssets() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, loading: false, error: null as string | null, create, remove }
}

export type { AssetInput }

// Hook de acceso a lotes (existencias por lote). HOY store mock; MAÑANA Supabase
// (select sobre lots) SIN tocar las pantallas.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshotLots, addEntry, adjust, type EntryInput } from '../store/lotsStore'

export function useLots() {
  const data = useSyncExternalStore(subscribe, getSnapshotLots, getSnapshotLots)
  return { data, loading: false, error: null as string | null, addEntry, adjust }
}

export type { EntryInput }

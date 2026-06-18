// Hook del ledger de movimientos de inventario (inmutable). HOY store mock;
// MAÑANA Supabase (select sobre inventory_movements).
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshotMovements } from '../store/lotsStore'

export function useInventory() {
  const data = useSyncExternalStore(subscribe, getSnapshotMovements, getSnapshotMovements)
  return { data, loading: false, error: null as string | null }
}

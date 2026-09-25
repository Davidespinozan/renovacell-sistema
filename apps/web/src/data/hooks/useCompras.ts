// Hook de reabastecimiento (Dirección crea; Almacén recibe). Mock hoy; con
// Supabase = tabla replenishments.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, createReplenishment, markReceived, markReceivedLocal, markPaid, reloadCompras, type PurchaseOrder, type ReplenKind } from '../store/comprasStore'

export function useCompras() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, createReplenishment, markReceived, markReceivedLocal, markPaid, reloadCompras }
}

export type { PurchaseOrder, ReplenKind }

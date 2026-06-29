// Hook de compras/reabastecimiento. Mock hoy; con Supabase = purchase_orders.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, createPurchase, markReceived, type PurchaseOrder } from '../store/comprasStore'

export function useCompras() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, createPurchase, markReceived }
}

export type { PurchaseOrder }

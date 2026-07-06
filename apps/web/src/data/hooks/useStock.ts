// Hook de disponibilidad por producto (para el Portal del Doctor). Devuelve un
// mapa product_id -> StockInfo, hidratado de la vista `product_stock`.
import { useMemo } from 'react'
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, toStockMap } from '../store/stockStore'
import type { StockInfo } from '../ops/stock'

export function useStock(): Record<string, StockInfo> {
  const rows = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => toStockMap(rows), [rows])
}

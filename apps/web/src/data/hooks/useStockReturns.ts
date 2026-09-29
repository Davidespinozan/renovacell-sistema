// Entrada física en dos pasos (devoluciones y reingresos por cancelación) · W1.
import { useSyncExternalStore } from 'react'
import { hasSupabase } from '../../lib/supabase'
import { subscribe, getSnapshot, ready, reloadReturns, type StockReturn } from '../store/stockReturnsStore'

export function useStockReturns(): { data: StockReturn[]; loading: boolean; reload: () => Promise<void> } {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, loading: hasSupabase && !ready(), reload: reloadReturns }
}

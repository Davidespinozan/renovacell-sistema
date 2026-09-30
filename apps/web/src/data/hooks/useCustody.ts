// W2-C · Lectura de la custodia para las pantallas. El libro es la única fuente:
// ninguna pantalla lleva `assigned`/`sold` propios ni calcula disponibilidad.
import { useMemo, useSyncExternalStore } from 'react'
import { hasSupabase } from '../../lib/supabase'
import {
  subscribeCustodies, getCustodiesSnapshot, custodiesReady,
  subscribeCustodyStock, getCustodyStockSnapshot,
  subscribeCustodyLines, getCustodyLinesSnapshot,
  subscribeDisponible, getDisponibleSnapshot, disponibleReady,
  disponiblePorProducto, reloadCustody,
} from '../store/custodyStore'
import type { Custody, CustodyLine, CustodyStock, StockDisponible } from '../ops/custody'

export function useCustodies(): { data: Custody[]; loading: boolean; reload: () => Promise<void> } {
  const data = useSyncExternalStore(subscribeCustodies, getCustodiesSnapshot, getCustodiesSnapshot)
  return { data, loading: hasSupabase && !custodiesReady(), reload: reloadCustody }
}

export function useCustodyStock(): { data: CustodyStock[]; reload: () => Promise<void> } {
  const data = useSyncExternalStore(subscribeCustodyStock, getCustodyStockSnapshot, getCustodyStockSnapshot)
  return { data, reload: reloadCustody }
}

export function useCustodyLines(): { data: CustodyLine[]; reload: () => Promise<void> } {
  const data = useSyncExternalStore(subscribeCustodyLines, getCustodyLinesSnapshot, getCustodyLinesSnapshot)
  return { data, reload: reloadCustody }
}

// Disponibilidad por lote y por producto, tal como la define el servidor.
export function useDisponible(): {
  data: StockDisponible[]; porProducto: Record<string, number>; loading: boolean; reload: () => Promise<void>
} {
  const data = useSyncExternalStore(subscribeDisponible, getDisponibleSnapshot, getDisponibleSnapshot)
  const porProducto = useMemo(() => disponiblePorProducto(data), [data])
  return { data, porProducto, loading: hasSupabase && !disponibleReady(), reload: reloadCustody }
}

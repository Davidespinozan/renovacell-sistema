// Disponibilidad por producto para pantallas del DOCTOR (no puede leer `lots`).
// Con backend hidrata de la vista `product_stock` (solo cantidad, sin lotes ni
// costos); sin backend, deriva del inventario mock. Devuelve un mapa listo para
// stockInfoFor().
import { LOW_STOCK, stockByProduct, type StockInfo } from '../ops/stock'
import { MOCK_LOTS } from '../mock/inventory'
import type { Lot } from '../types'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'

interface StockRow { product_id: string; available: number }

const rowsFromLots = (lots: Lot[]): StockRow[] =>
  Object.entries(stockByProduct(lots)).map(([product_id, si]) => ({ product_id, available: si.qty }))

// Fallback mock: disponibilidad derivada de los lotes de demostración.
const fallback: StockRow[] = rowsFromLots(MOCK_LOTS)

const live = makeLive<StockRow>(async () => {
  const { data, error } = await supabase.from('product_stock').select('product_id, available')
  if (error) throw error
  return (data ?? []).map((r) => ({ product_id: r.product_id ?? '', available: r.available ?? 0 }))
}, fallback)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

// Invalida la disponibilidad tras un movimiento de inventario (lo llama lotsStore).
// Con backend re-consulta product_stock; en mock recalcula de los lotes actuales.
export function refreshStock(lots?: Lot[]) {
  if (hasSupabase) { live.reload(); return }
  if (lots) live.setLocal(rowsFromLots(lots))
}

export function toStockMap(rows: StockRow[]): Record<string, StockInfo> {
  const out: Record<string, StockInfo> = {}
  rows.forEach((r) => {
    out[r.product_id] = { qty: r.available, tracked: true, status: r.available <= 0 ? 'out' : r.available <= LOW_STOCK ? 'low' : 'ok' }
  })
  return out
}

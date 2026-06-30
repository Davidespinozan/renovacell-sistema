// Existencias por producto a partir de los lotes (excluye caducados). Lo usa el
// catálogo del doctor para mostrar estado tipo tienda: Agotado / Quedan pocas /
// Disponible — y para no dejar pedir más de lo que hay.
import type { Lot } from '../types'

export const LOW_STOCK = 10 // umbral "quedan pocas"

export type StockStatus = 'ok' | 'low' | 'out' | 'untracked'
export interface StockInfo {
  qty: number          // unidades disponibles (lotes vigentes)
  tracked: boolean     // el producto tiene inventario por lotes
  status: StockStatus
}

export function stockByProduct(lots: Lot[]): Record<string, StockInfo> {
  const today = new Date().toISOString().slice(0, 10)
  const tracked = new Set<string>()
  const qty: Record<string, number> = {}
  lots.forEach((l) => {
    tracked.add(l.product_id)
    if (l.expiry_date != null && l.expiry_date < today) return // caducado no cuenta
    qty[l.product_id] = (qty[l.product_id] ?? 0) + l.quantity
  })
  const out: Record<string, StockInfo> = {}
  tracked.forEach((pid) => {
    const q = qty[pid] ?? 0
    out[pid] = { qty: q, tracked: true, status: q <= 0 ? 'out' : q <= LOW_STOCK ? 'low' : 'ok' }
  })
  return out
}

export function stockInfoFor(map: Record<string, StockInfo>, productId: string): StockInfo {
  return map[productId] ?? { qty: 0, tracked: false, status: 'untracked' }
}

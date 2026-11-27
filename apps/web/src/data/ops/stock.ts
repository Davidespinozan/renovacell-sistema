// Existencias por producto a partir de los lotes (excluye caducados). Lo usa el
// catálogo del doctor para mostrar estado tipo tienda: Agotado / Quedan pocas /
// Disponible — y para no dejar pedir más de lo que hay.
import type { Lot } from '../types'
import { hoyNegocio } from '../periodo'

export const LOW_STOCK = 10 // umbral "quedan pocas" (aviso al doctor en el catálogo)
export const REORDER_THRESHOLD = 20 // umbral de REORDEN (alerta a Almacén / Reabastecimiento)

export type StockStatus = 'ok' | 'low' | 'out' | 'untracked'
export interface StockInfo {
  qty: number          // unidades disponibles (lotes vigentes)
  tracked: boolean     // el producto tiene inventario por lotes
  status: StockStatus
}

export function stockByProduct(lots: Lot[]): Record<string, StockInfo> {
  const today = hoyNegocio()
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

// ═══ NIVELES POR PRODUCTO (27 nov 2026, dueño: «Dirección no puede ajustar el inventario sugerido»). Antes eran dos
// números fijos para todo el catálogo: «Bajo» con 20 o menos, y sugerir compra hasta completar 60. Ahora cada producto
// puede tener su MÍNIMO (cuándo avisar) y su IDEAL (hasta cuánto reponer); sin nivel propio sigue con los generales.
export const IDEAL_POR_DEFECTO = 60
export type NivelesStock = Record<string, { minimo: number; ideal: number }>
export interface NivelStock { minimo: number; ideal: number; propio: boolean }
/** El nivel que aplica a un producto: el suyo si Dirección lo fijó; si no, el general (20 y 60). */
export function nivelDe(niveles: NivelesStock | null | undefined, productId: string): NivelStock {
  const n = niveles?.[productId]
  return n && Number.isFinite(n.minimo) && Number.isFinite(n.ideal) && n.ideal >= n.minimo && n.minimo >= 0
    ? { minimo: n.minimo, ideal: n.ideal, propio: true }
    : { minimo: REORDER_THRESHOLD, ideal: IDEAL_POR_DEFECTO, propio: false }
}
/** Cuánto conviene comprar: lo que falta para llegar al ideal, descontando lo que ya viene en camino. Nunca negativo. */
export function sugeridoDeCompra(existencia: number, nivel: Pick<NivelStock, 'ideal'>, enCamino = 0): number {
  return Math.max(0, nivel.ideal - existencia - Math.max(0, enCamino))
}
/** Por qué no se puede guardar ese nivel, en palabras; null si está bien. Mismas reglas que `stock_nivel_guardar`. */
export function errorDeNivel(minimo: number, ideal: number): string | null {
  if (!Number.isFinite(minimo) || !Number.isFinite(ideal)) return 'Escribe los dos valores: el mínimo y el ideal.'
  if (!Number.isInteger(minimo) || !Number.isInteger(ideal)) return 'Usa números enteros.'
  if (minimo < 0) return 'El mínimo no puede ser negativo.'
  if (ideal < 1 || ideal > 1_000_000) return 'El ideal debe ser de 1 a 1,000,000.'
  if (ideal < minimo) return 'El ideal no puede ser menor que el mínimo.'
  return null
}

// ENTRADA FÍSICA en dos pasos (W1 · D-02 / D-03). Lee `stock_returns` + `stock_return_lines`
// (solo lectura por RLS; escriben los comandos del servidor):
//  · origin 'cancelacion': al cancelar un pedido EMPACADO, con los lotes realmente consumidos
//    → Almacén confirma el reacomodo (confirmar_reingreso).
//  · origin 'devolucion': Almacén recibe e inspecciona (recibir_devolucion) → Dirección dispone
//    VENDIBLE o MERMA (disponer_devolucion).
// Sin éxito optimista: cada comando espera al servidor y recarga. Sin backend (demo) la
// entrada física en dos pasos no está disponible (requiere el kardex del servidor).
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'
import { runW1Command, type W1Result } from '../ops/w1Command'
import { reloadInventory } from './lotsStore'
import { reloadOrders } from './ordersStore'

export type Inspection = 'ok' | 'dañado' | 'caducado'
export type Disposition = 'vendible' | 'merma'

export interface StockReturnLine {
  id: string
  return_id: string
  order_id: string
  order_item_id: string | null
  product_id: string
  lot_id: string
  qty: number
  inspection: Inspection | null
  notes: string | null
  disposition: Disposition | null
  created_at: string
}
export interface StockReturn {
  id: string
  order_id: string
  origin: 'devolucion' | 'cancelacion'
  notes: string | null
  created_at: string
  lines: StockReturnLine[]
}

const live = makeLive<StockReturn>(async () => {
  const { data, error } = await supabase.from('stock_returns')
    .select('id, order_id, origin, notes, created_at, lines:stock_return_lines(id, return_id, order_id, order_item_id, product_id, lot_id, qty, inspection, notes, disposition, created_at)')
    .order('created_at', { ascending: false }) as unknown as { data: StockReturn[] | null; error: { message: string } | null }
  if (error) throw error
  return (data ?? []).map((r) => ({ ...r, lines: r.lines ?? [] }))
}, [])

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot
export const ready = live.ready
export const reloadReturns = (): Promise<void> => live.reload()

// Reingresos de cancelación esperando confirmación física de Almacén.
export const pendingReingresos = (list: StockReturn[]): StockReturn[] =>
  list.filter((r) => r.origin === 'cancelacion' && r.lines.some((l) => l.inspection === null))
// Renglones inspeccionados esperando que Dirección decida el destino.
export const pendingDisposicion = (list: StockReturn[]): { ret: StockReturn; line: StockReturnLine }[] =>
  list.flatMap((ret) => ret.lines.filter((l) => l.inspection !== null && l.disposition === null).map((line) => ({ ret, line })))

// Lo que REALMENTE salió en un pedido (kardex: surtido/venta), por lote, menos lo ya devuelto
// (incluye devoluciones pendientes). Es exactamente el tope que impone el servidor.
export interface Returnable { lot_id: string; salido: number; devuelto: number; disponible: number }
export async function returnableForOrder(orderId: string): Promise<Returnable[]> {
  if (!hasSupabase) return []
  const { data } = await supabase.from('inventory_movements')
    .select('lot_id, change, reason')
    .eq('order_id', orderId)
    .in('reason', ['surtido', 'venta']) as unknown as { data: { lot_id: string; change: number }[] | null }
  const salido: Record<string, number> = {}
  ;(data ?? []).forEach((m) => { salido[m.lot_id] = (salido[m.lot_id] ?? 0) + -m.change })
  const devuelto: Record<string, number> = {}
  live.current().forEach((r) => r.lines.forEach((l) => { if (l.order_id === orderId) devuelto[l.lot_id] = (devuelto[l.lot_id] ?? 0) + l.qty }))
  return Object.entries(salido).filter(([, s]) => s > 0).map(([lot_id, s]) => ({
    lot_id, salido: s, devuelto: devuelto[lot_id] ?? 0, disponible: Math.max(0, s - (devuelto[lot_id] ?? 0)),
  }))
}

const NO_BACKEND: W1Result = { ok: false, error: 'La devolución física requiere el sistema conectado.' }

async function after<T>(r: W1Result<T>): Promise<W1Result<T>> {
  if (r.ok) { await live.reload(); reloadInventory(); reloadOrders() }
  return r
}

// Paso 1 (Almacén): recibe e inspecciona; NO mueve stock.
export async function recibirDevolucion(opId: string, orderId: string, lines: { lot_id: string; qty: number; inspection: 'ok' | 'dañado'; notes?: string | null }[], notes?: string | null): Promise<W1Result> {
  if (!hasSupabase) return NO_BACKEND
  return after(await runW1Command('recibir_devolucion', { p_op_id: opId, p_order: orderId, p_lines: lines, p_notes: notes ?? undefined }, opId))
}

// Cancelación de empacado (Almacén): confirma el reacomodo físico de cada renglón.
export async function confirmarReingreso(opId: string, returnId: string, lines: { line_id: string; estado: 'ok' | 'dañado' }[]): Promise<W1Result> {
  if (!hasSupabase) return NO_BACKEND
  return after(await runW1Command('confirmar_reingreso', { p_op_id: opId, p_return_id: returnId, p_lines: lines }, opId))
}

// Paso 2 (Dirección): destino final de cada renglón.
export async function disponerDevolucion(opId: string, lines: { line_id: string; disposition: Disposition }[]): Promise<W1Result> {
  if (!hasSupabase) return NO_BACKEND
  return after(await runW1Command('disponer_devolucion', { p_op_id: opId, p_lines: lines }, opId))
}

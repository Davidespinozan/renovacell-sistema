// W2-C · Store de la custodia. Mantiene VIVAS las lecturas que las pantallas necesitan:
//   · custodies          — los acuerdos (evento o vendedor) que el rol puede ver
//   · v_custody_stock    — el saldo por custodia/producto/lote, DERIVADO del libro
//   · custody_lines      — el libro (historia completa: entrega, venta, devolución, pérdida)
//   · v_stock_disponible — disponibilidad por lote (propio − en custodia)
// Ninguna pantalla lleva contadores propios. Toda mutación pasa por ops/custody.ts y
// después llama a `reloadCustody()` (write-through, sin éxito optimista).
import { supabase, hasSupabase } from '../../lib/supabase'
import { leerTodo } from './lectura'
import { makeLive } from './live'
import {
  CUSTODY_COLS, CUSTODY_LINE_COLS, CUSTODY_STOCK_COLS, DISPONIBLE_COLS,
  type Custody, type CustodyLine, type CustodyStock, type StockDisponible,
} from '../ops/custody'

const custodiesLive = makeLive<Custody>(async () => {
  const { data, error } = await leerTodo('las custodias', (a, b) => supabase.from('custodies').select(CUSTODY_COLS).order('opened_at', { ascending: false }).order('id').range(a, b))
  if (error) throw error
  return (data ?? []) as unknown as Custody[]
}, [])

const stockLive = makeLive<CustodyStock>(async () => {
  const { data, error } = await leerTodo('el inventario en custodia', (a, b) => supabase.from('v_custody_stock').select(CUSTODY_STOCK_COLS).order('custody_id').order('lot_id').range(a, b))
  if (error) throw error
  return (data ?? []) as unknown as CustodyStock[]
}, [])

const linesLive = makeLive<CustodyLine>(async () => {
  const { data, error } = await leerTodo('los movimientos de custodia', (a, b) => supabase.from('custody_lines').select(CUSTODY_LINE_COLS).order('created_at', { ascending: false }).order('id').range(a, b))
  if (error) throw error
  return (data ?? []) as unknown as CustodyLine[]
}, [])

const dispLive = makeLive<StockDisponible>(async () => {
  const { data, error } = await leerTodo('la disponibilidad de inventario', (a, b) => supabase.from('v_stock_disponible').select(DISPONIBLE_COLS).order('lot_id').range(a, b))
  if (error) throw error
  return (data ?? []) as unknown as StockDisponible[]
}, [])

export const subscribeCustodies = custodiesLive.subscribe
export const getCustodiesSnapshot = custodiesLive.getSnapshot
export const custodiesReady = custodiesLive.ready

export const subscribeCustodyStock = stockLive.subscribe
export const getCustodyStockSnapshot = stockLive.getSnapshot

export const subscribeCustodyLines = linesLive.subscribe
export const getCustodyLinesSnapshot = linesLive.getSnapshot

export const subscribeDisponible = dispLive.subscribe
export const getDisponibleSnapshot = dispLive.getSnapshot
export const disponibleReady = dispLive.ready

// Tras CUALQUIER comando de custodia: el servidor es la autoridad, se vuelve a leer.
// La disponibilidad también, porque entregar/devolver/perder la mueve.
export async function reloadCustody(): Promise<void> {
  if (!hasSupabase) return
  await Promise.all([custodiesLive.reload(), stockLive.reload(), linesLive.reload(), dispLive.reload()])
}

// --- Derivaciones para pantalla (puras, sobre lo que ya leyó el servidor) -----

// Saldo VIVO de una custodia (lo que el tenedor tiene en la mano ahora).
export const saldoDe = (stock: CustodyStock[], custodyId: string): CustodyStock[] =>
  stock.filter((s) => s.custody_id === custodyId && s.en_poder > 0)

// Saldo agregado por producto (para la pantalla del vendedor, que piensa en productos).
export function saldoPorProducto(stock: CustodyStock[], custodyId: string): Record<string, number> {
  const m: Record<string, number> = {}
  stock.filter((s) => s.custody_id === custodyId).forEach((s) => { m[s.product_id] = (m[s.product_id] ?? 0) + s.en_poder })
  return m
}

// Disponibilidad por producto, según la autoridad del servidor (no se recalcula aquí).
export function disponiblePorProducto(disp: StockDisponible[]): Record<string, number> {
  const m: Record<string, number> = {}
  disp.filter((d) => !d.caducado).forEach((d) => { m[d.product_id] = (m[d.product_id] ?? 0) + d.disponible })
  return m
}

// Lotes de un producto con disponibilidad real, en orden FEFO. Es lo que Almacén puede
// entregar en custodia y lo que el POS puede vender de mostrador.
export const lotesDisponibles = (disp: StockDisponible[], productId: string): StockDisponible[] =>
  disp.filter((d) => d.product_id === productId && d.disponible > 0 && !d.caducado)
      .sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999'))

// La custodia ABIERTA de un tenedor (a lo más una por tipo).
export const custodiaAbiertaDe = (custodies: Custody[], holderUserId: string | null, kind: 'vendedor' | 'evento' = 'vendedor'): Custody | null =>
  custodies.find((c) => c.status === 'abierta' && c.kind === kind && c.holder_user_id === holderUserId) ?? null

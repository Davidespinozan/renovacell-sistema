// W2-C · CUSTODIA — cliente único de los comandos y de la lectura.
//
// Reglas que este módulo hace cumplir en el frontend:
//  · `custody_lines` (el libro) es la ÚNICA verdad de la custodia. Ninguna pantalla
//    lleva contadores de `assigned`/`sold`: los saldos salen de `v_custody_stock`.
//  · ENTREGAR no es vender ni prestar: no mueve inventario, no genera COGS, ni
//    revenue, ni cuenta por cobrar. Lo único que cambia es la DISPONIBILIDAD.
//  · La obligación económica nace en la VENTA, y la venta va por la MISMA ruta que
//    el mostrador (`vender_pos` con `p_custody_id`): un solo motor de pedidos,
//    precios, inventario y dinero.
//  · Faltante, daño y caducidad son hechos propios: baja real de inventario con
//    motivo y evidencia. NUNCA una venta fingida y NUNCA deuda del tenedor.
//  · `disponible = propio − en custodia` es la autoridad del servidor: el frontend
//    no lo calcula, lo lee de `v_stock_disponible`.
import { supabase, hasSupabase } from '../../lib/supabase'
import { runW1Command, type W1Result } from './w1Command'
import type { Database } from '../database.types'

type Fns = Database['public']['Functions']

export type CustodyKind = 'evento' | 'vendedor'
export type HolderKind = 'staff' | 'doctor' | 'tercero'
export type CustodyLineKind = 'entrega' | 'venta' | 'devolucion' | 'faltante' | 'merma' | 'caducado' | 'ajuste'
export type Inspeccion = 'ok' | 'dañado' | 'caducado'
export type PerdidaKind = 'faltante' | 'merma' | 'caducado'

export const INSPECCIONES: { value: Inspeccion; label: string }[] = [
  { value: 'ok', label: 'Llegó en buen estado' },
  { value: 'dañado', label: 'Llegó dañado' },
  { value: 'caducado', label: 'Llegó caducado' },
]
export const PERDIDAS: { value: PerdidaKind; label: string; hint: string }[] = [
  { value: 'faltante', label: 'Faltante', hint: 'No apareció en el conteo físico' },
  { value: 'merma', label: 'Daño', hint: 'Se rompió o se echó a perder' },
  { value: 'caducado', label: 'Caducado', hint: 'Venció estando en custodia' },
]

export interface Custody {
  id: string
  kind: CustodyKind
  holder_kind: HolderKind
  holder_user_id: string | null
  holder_customer_id: string | null
  event_name: string | null
  event_venue: string | null
  event_date: string | null
  status: 'abierta' | 'cerrada'
  opened_at: string
  closed_at: string | null
  close_reason: string | null
}
export const CUSTODY_COLS =
  'id, kind, holder_kind, holder_user_id, holder_customer_id, event_name, event_venue, event_date, ' +
  'status, opened_at, closed_at, close_reason'

export interface CustodyLine {
  id: string
  custody_id: string
  kind: CustodyLineKind
  product_id: string
  lot_id: string
  qty: number
  held_delta: number
  unit_price: number | null
  order_id: string | null
  order_item_id: string | null
  inventory_op_id: string | null
  motivo: string | null
  evidence_ref: string | null
  actor_role: string | null
  created_at: string
}
export const CUSTODY_LINE_COLS =
  'id, custody_id, kind, product_id, lot_id, qty, held_delta, unit_price, order_id, order_item_id, ' +
  'inventory_op_id, motivo, evidence_ref, actor_role, created_at'

// Saldo por custodia/producto/lote — DERIVADO del libro, nunca un contador.
export interface CustodyStock {
  custody_id: string
  product_id: string
  lot_id: string
  entregado: number
  vendido: number
  devuelto: number
  perdido: number
  en_poder: number
}
export const CUSTODY_STOCK_COLS =
  'custody_id, product_id, lot_id, entregado, vendido, devuelto, perdido, en_poder'

// Disponibilidad por LOTE: la autoridad de lo que se puede prometer, asignar o vender.
export interface StockDisponible {
  lot_id: string
  product_id: string
  lot_code: string
  expiry_date: string | null
  location: string | null
  propio: number
  en_custodia: number
  disponible: number
  caducado: boolean
}
export const DISPONIBLE_COLS =
  'lot_id, product_id, lot_code, expiry_date, location, propio, en_custodia, disponible, caducado'

export interface CustodyLiquidacion {
  custody_id: string
  kind: CustodyKind
  status: string
  unidades_entregadas: number
  unidades_vendidas: number
  unidades_devueltas: number
  unidades_perdidas: number
  unidades_en_poder: number
  importe_vendido: number
  cobrado: number
  saldo: number
}
export const LIQUIDACION_COLS =
  'custody_id, kind, status, unidades_entregadas, unidades_vendidas, unidades_devueltas, ' +
  'unidades_perdidas, unidades_en_poder, importe_vendido, cobrado, saldo'

// --- LECTURA -----------------------------------------------------------------

export async function liquidacionDe(custodyId: string): Promise<CustodyLiquidacion | null> {
  if (!hasSupabase) return null
  const { data, error } = await supabase.from('v_custody_liquidacion').select(LIQUIDACION_COLS).eq('custody_id', custodyId).maybeSingle()
  if (error || !data) return null
  return data as unknown as CustodyLiquidacion
}

// Ficha completa por el comando de lectura (saldos + movimientos, con su RLS).
export async function estadoCustodia(custodyId: string): Promise<Record<string, unknown> | null> {
  if (!hasSupabase) return null
  const { data, error } = await supabase.rpc('estado_custodia', { p_custody: custodyId })
  if (error || !data || typeof data !== 'object') return null
  return data as Record<string, unknown>
}

// --- COMANDOS ----------------------------------------------------------------
// Cada uno recibe el op_id de la INTENCIÓN (useOpId): un reintento no duplica nada.
// Comparten el registro de idempotencia de inventario a través de runW1Command para
// la venta, y el propio de custodia para el resto (ver estadoOperacionCustodia).

async function runCustody<T>(rpc: keyof Fns & string, params: unknown, opId: string): Promise<W1Result<T>> {
  // Mismo cliente y mismas reglas que W1/W2; la recuperación ambigua consulta el
  // registro de custodia.
  const r = await runW1Command<T>(rpc as never, params as never, opId)
  if (r.ok || !r.ambiguous) return r
  const prev = await estadoOperacionCustodia(opId)
  return prev ? { ok: true, status: 'already_applied', data: prev as T } : r
}

// Recuperación ante respuesta AMBIGUA: ¿el servidor ya registró la operación?
export async function estadoOperacionCustodia(opId: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.rpc('estado_operacion_custodia', { p_op_id: opId })
    if (error) return null
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const abrirCustodia = (opId: string, a: {
  kind: CustodyKind; holderKind: HolderKind
  holderUserId?: string | null; holderCustomerId?: string | null
  eventName?: string | null; eventVenue?: string | null; eventDate?: string | null
}) => runCustody<{ custody_id: string; kind: string }>('abrir_custodia', {
  p_op_id: opId, p_kind: a.kind, p_holder_kind: a.holderKind,
  p_holder_user_id: a.holderUserId ?? undefined, p_holder_customer_id: a.holderCustomerId ?? undefined,
  p_event_name: a.eventName ?? undefined, p_event_venue: a.eventVenue ?? undefined,
  p_event_date: a.eventDate ?? undefined,
}, opId)

export const entregarCustodia = (opId: string, a: { custodyId: string; lines: { lot_id: string; qty: number }[] }) =>
  runCustody<{ custody_id: string; renglones: number; unidades: number }>('entregar_custodia', {
    p_op_id: opId, p_custody: a.custodyId, p_lines: a.lines as never,
  }, opId)

export const devolverDeCustodia = (opId: string, a: {
  custodyId: string; lines: { lot_id: string; qty: number; inspection: Inspeccion }[]; motivo?: string | null
}) => runCustody<{ devuelto_disponible: number; dado_de_baja: number }>('devolver_de_custodia', {
  p_op_id: opId, p_custody: a.custodyId, p_lines: a.lines as never, p_motivo: a.motivo ?? undefined,
}, opId)

export const registrarPerdidaCustodia = (opId: string, a: {
  custodyId: string; kind: PerdidaKind; lines: { lot_id: string; qty: number }[]; motivo: string; evidencia?: string | null
}) => runCustody<{ kind: string; unidades: number; nota: string }>('registrar_perdida_custodia', {
  p_op_id: opId, p_custody: a.custodyId, p_kind: a.kind, p_lines: a.lines as never,
  p_motivo: a.motivo, p_evidencia: a.evidencia ?? undefined,
}, opId)

export const cerrarCustodia = (opId: string, a: { custodyId: string; motivo: string }) =>
  runCustody<{
    custody_id: string; entregadas: number; vendidas: number; devueltas: number; perdidas: number
    importe_vendido: number; cobrado: number; saldo: number
  }>('cerrar_custodia', { p_op_id: opId, p_custody: a.custodyId, p_motivo: a.motivo }, opId)

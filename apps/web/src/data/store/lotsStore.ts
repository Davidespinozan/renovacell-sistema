// Store de lotes + ledger de movimientos. Con backend (hasSupabase) hidrata de
// `lots` e `inventory_movements` y las mutaciones escriben write-through (insertan
// el movimiento inmutable y actualizan la cantidad del lote). Sin backend, opera
// sobre el mock. Trazabilidad COFEPRIS: los movimientos solo se agregan.
import type { Lot, InventoryMovement } from '../types'
import { MOCK_LOTS, MOCK_MOVEMENTS } from '../mock/inventory'
import { notify } from './notificationsStore'
import { getSnapshot as productsSnapshot } from './productsStore'
import { costOf } from '../mock/costs'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'
import { refreshStock } from './stockStore'
import { REORDER_THRESHOLD } from '../ops/stock'
import { blendedLotCost } from '../ops/inventoryCost'
import { runW1Command, newOpId, type W1Result } from '../ops/w1Command'
import { reloadCompras } from './comprasStore'
import { leerTodo } from './lectura'

const LOW_STOCK_REORDER = REORDER_THRESHOLD // umbral de reorden único (ver ops/stock)

function sortDesc(m: InventoryMovement[]): InventoryMovement[] {
  return [...m].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

const lotsFallback: Lot[] = MOCK_LOTS.map((l) => ({ ...l, unit_cost: l.unit_cost ?? costOf(l.product_id) }))
const movsFallback: InventoryMovement[] = sortDesc(MOCK_MOVEMENTS)

const lotsLive = makeLive<Lot>(async () => {
  // El costo real vive en `product_costs` (uuid → unit_cost), protegido por RLS
  // (solo admin/billing lo lee). Para otros roles la consulta devuelve [] y el
  // costo queda en 0 —correcto: no ven finanzas. NUNCA usar costOf(uuid): sus
  // claves son slugs legacy ('p-mgp-90') y con uuid siempre daría 0 (utilidad falsa).
  // Fase 2: el costo REAL de valoración del lote vive en lots.unit_cost (costo de
  // adquisición conocido; NULL = desconocido). product_costs queda como referencia (Catálogo),
  // NO se usa aquí para valorar (evita presentar el estándar como costo real del lote).
  const { data: lotsData, error: lotsErr } = await leerTodo('los lotes', (a, b) => supabase.from('lots')
    .select('id, product_id, lot_code, manufacture_date, expiry_date, quantity, location, unit_cost, metadata').order('id').range(a, b))
  if (lotsErr) throw lotsErr
  const mapped = (lotsData ?? []).map((l) => ({
    id: l.id, product_id: l.product_id ?? '', lot_code: l.lot_code,
    manufacture_date: l.manufacture_date, expiry_date: l.expiry_date, quantity: l.quantity,
    location: l.location, unit_cost: (l as { unit_cost?: number | null }).unit_cost ?? null, metadata: (l.metadata ?? null) as Lot['metadata'],
  }))
  flagExpiring(mapped) // avisa de lotes por caducar / caducados al cargar inventario
  return mapped
}, lotsFallback)

const movsLive = makeLive<InventoryMovement>(async () => {
  const { data, error } = await leerTodo('los movimientos de inventario', (a, b) => supabase
    .from('inventory_movements')
    .select('id, lot_id, change, reason, reference, created_by, created_at, unit_cost')
    .order('created_at', { ascending: false }).order('id').range(a, b))
  if (error) throw error
  return (data ?? []).map((m) => ({
    id: m.id, lot_id: m.lot_id ?? '', change: m.change, reason: m.reason ?? '',
    reference: m.reference, created_by: m.created_by, created_at: m.created_at ?? '',
    unit_cost: (m as { unit_cost?: number | null }).unit_cost ?? null,
  }))
}, movsFallback)

// Subscribe combinado: cualquier cambio en lotes o movimientos notifica.
export function subscribe(cb: () => void): () => void {
  const u1 = lotsLive.subscribe(cb)
  const u2 = movsLive.subscribe(cb)
  return () => { u1(); u2() }
}
export const getSnapshotLots = (): Lot[] => lotsLive.getSnapshot()
export const getSnapshotMovements = (): InventoryMovement[] => movsLive.getSnapshot()

// Total DISPONIBLE (excluye caducados) de los productos indicados.
function totalsFor(ids: Set<string>): Record<string, number> {
  const today = new Date().toISOString().slice(0, 10)
  const m: Record<string, number> = {}
  lotsLive.current().forEach((l) => {
    if (!ids.has(l.product_id)) return
    if (l.expiry_date != null && l.expiry_date < today) return
    m[l.product_id] = (m[l.product_id] ?? 0) + l.quantity
  })
  return m
}
function flagLowStock(before: Record<string, number>, ids: Set<string>) {
  const after = totalsFor(ids)
  const names = Object.fromEntries(productsSnapshot().map((p) => [p.id, p.name]))
  ids.forEach((pid) => {
    const b = before[pid] ?? 0, a = after[pid] ?? 0
    if (b > LOW_STOCK_REORDER && a <= LOW_STOCK_REORDER) {
      // screen 'compras' (nav de Almacén): antes 'av_inv' (solo nav de Dirección) →
      // el filtro de la campana descartaba el aviso para el almacenista, justo el que
      // debe reabastecer. Dirección lo sigue viendo por el short-circuit admin.
      notify({ text: a <= 0 ? `Agotado: ${names[pid] ?? 'producto'} · reabastece` : `Stock bajo: ${names[pid] ?? 'producto'} (${a} u) · reabastece`, roles: ['warehouse', 'admin'], screen: 'compras' })
    }
  })
}

// Alerta de CADUCIDAD: producto médico regulado por vencer/vencido. Antes era pull-only
// (había que abrir la pantalla para enterarse). Se avisa a Almacén + Dirección UNA sola
// vez por lote y por sesión (dedup), cuando el lote está crítico (≤60 días) o vencido.
const notifiedExpiry = new Set<string>()
function flagExpiring(lots: Lot[]): void {
  const names = Object.fromEntries(productsSnapshot().map((p) => [p.id, p.name]))
  lots.forEach((l) => {
    if (l.quantity <= 0 || !l.expiry_date) return
    const days = Math.ceil((Date.parse(l.expiry_date) - Date.now()) / 86_400_000)
    if (Number.isNaN(days) || days > 60) return // solo crítico (≤60) o vencido (<0)
    if (notifiedExpiry.has(l.id)) return
    notifiedExpiry.add(l.id)
    const nombre = names[l.product_id] ?? l.lot_code
    notify({
      text: days < 0
        ? `Lote CADUCADO: ${nombre} (${l.lot_code}) · ${l.quantity} u — dar de baja`
        : `Por caducar: ${nombre} (${l.lot_code}) en ${days} día${days === 1 ? '' : 's'} · ${l.quantity} u`,
      roles: ['warehouse', 'admin'], screen: 'caduc',
    })
  })
}
// En modo demo (sin backend) el loader no corre; revisa el mock una vez al arrancar.
if (!hasSupabase) setTimeout(() => flagExpiring(lotsLive.current()), 0)

let seq = 1000
const nowIso = () => new Date().toISOString()

export interface EntryInput {
  product_id: string
  lot_code: string
  expiry_date: string | null
  quantity: number
  location: string | null
  unit_cost?: number | null
}

export type ReceiveKind = 'orden' | 'sin_orden' | 'excedente'
export interface ReceiveInput extends EntryInput {
  reason?: string
  reference?: string | null
  replenishment_id?: string | null // recepción contra una orden (acumula; parcial/recibida en la misma tx)
  op_id?: string                   // W1: op_id estable de la intención (reintentos no duplican)
  kind?: ReceiveKind               // W1: orden (almacén) · sin_orden / excedente (solo Dirección, con motivo)
  evidence?: string | null
}
export interface ReceiveResult {
  ok: boolean; error?: string; lot_id?: string; ambiguous?: boolean; status?: string
  replenishment_status?: string | null; pending_qty?: number | null
}

// RECEPCIÓN/ENTRADA ATÓMICA (Fase 1). Backend: RPC `recibir_lote` (crea/suma lote +
// movimiento + costo congelado, y opcionalmente marca la compra recibida en UNA
// transacción → sin el estado inconsistente "stock arriba pero compra pendiente").
// Mock: upsert-or-create local con promedio ponderado (blendedLotCost) + movimiento.
// Devuelve {ok} con error real (no console.warn silencioso).
export async function recibirLote(input: ReceiveInput): Promise<ReceiveResult> {
  const reason = (input.reason ?? '').trim() || 'entrada'
  const reference = input.reference ?? input.lot_code
  if (!input.product_id || !(input.lot_code ?? '').trim()) return { ok: false, error: 'Falta producto o lote.' }
  if (!(input.quantity > 0)) return { ok: false, error: 'La cantidad debe ser mayor que 0.' }
  const inc = input.unit_cost ?? null

  if (hasSupabase) {
    // W1: comando del servidor (identidad canónica, caducidad, acumulado, idempotencia por op_id).
    // Sin éxito optimista: la pantalla refleja solo lo que el servidor confirmó.
    if (!input.expiry_date) return { ok: false, error: 'Indica la fecha de caducidad del lote.' }
    const kind: ReceiveKind = input.kind ?? (input.replenishment_id ? 'orden' : 'sin_orden')
    const opId = input.op_id ?? newOpId()
    const r: W1Result<{ lot_id?: string; replenishment_status?: string | null; pending_qty?: number | null }> =
      await runW1Command('recibir_lote', {
        p_op_id: opId, p_product: input.product_id, p_lote: input.lot_code, p_caducidad: input.expiry_date,
        p_cantidad: input.quantity, p_replenishment_id: input.replenishment_id ?? undefined, p_kind: kind,
        p_unit_cost: kind === 'orden' ? undefined : (inc ?? undefined), p_reason: kind === 'orden' ? undefined : (input.reason ?? undefined),
        p_evidence: input.evidence ?? undefined,
      }, opId)
    if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
    await Promise.all([lotsLive.reload(), movsLive.reload()]); refreshStock(); reloadCompras()
    return { ok: true, status: r.status, lot_id: r.data.lot_id, replenishment_status: r.data.replenishment_status ?? null, pending_qty: r.data.pending_qty ?? null }
  }

  // Mock: identidad = producto + código de lote (suma, no idempotente).
  const key = input.lot_code.trim().toLowerCase()
  const existing = lotsLive.current().find((l) => l.product_id === input.product_id && (l.lot_code ?? '').trim().toLowerCase() === key)
  seq += 1
  if (existing) {
    const newCost = blendedLotCost(existing.quantity, existing.unit_cost ?? null, input.quantity, inc)
    lotsLive.setLocal(lotsLive.current().map((l) => (l.id === existing.id
      ? { ...l, quantity: l.quantity + input.quantity, unit_cost: newCost, expiry_date: l.expiry_date ?? input.expiry_date }
      : l)))
    movsLive.setLocal([{ id: `m-${seq}`, lot_id: existing.id, change: input.quantity, reason, reference, created_by: null, created_at: nowIso() }, ...movsLive.current()])
    refreshStock(lotsLive.current())
    return { ok: true, lot_id: existing.id }
  }
  const lot: Lot = {
    id: `l-${seq}`, product_id: input.product_id, lot_code: input.lot_code, manufacture_date: null,
    expiry_date: input.expiry_date, quantity: input.quantity, location: input.location,
    unit_cost: inc ?? costOf(input.product_id), metadata: null,
  }
  lotsLive.setLocal([...lotsLive.current(), lot])
  movsLive.setLocal([{ id: `m-${seq}`, lot_id: lot.id, change: input.quantity, reason, reference, created_by: null, created_at: nowIso() }, ...movsLive.current()])
  refreshStock(lotsLive.current())
  return { ok: true, lot_id: lot.id }
}

// Compat: Registrar entrada legacy → delega en la recepción atómica (fire-and-forget).
// Lo usan flujos que no esperan feedback (p.ej. regreso de evento en eventsStore).
export function addEntry(input: EntryInput): void {
  if (hasSupabase) throw new Error(W1_DIRECT_DISABLED)
  void recibirLote(input)
}

// W1: con backend, el inventario SOLO cambia por comandos del servidor. Los caminos
// directos de abajo (adjust / restockByReference / consume no-local / addEntry) quedan
// para el modo demo (sin backend); con backend fallan cerrado (eventos y consignación
// están deshabilitados hasta W2 y no llegan aquí).
export const W1_DIRECT_DISABLED = 'Movimiento directo de inventario deshabilitado (W1): usa el comando correspondiente.'

export type AjusteKind = 'merma' | 'ajuste' | 'correccion_recepcion'
// MERMA / AJUSTE (D-06). Almacén da de baja con motivo (efecto inmediato, auditado); el
// ajuste POSITIVO y la corrección de recepción son solo de Dirección (lo impone el servidor).
export async function ajustarLote(input: { op_id: string; lot_id: string; delta: number; kind: AjusteKind; reason: string; receipt_id?: string | null }): Promise<{ ok: boolean; error?: string; ambiguous?: boolean; status?: string }> {
  if (!input.reason.trim()) return { ok: false, error: 'Escribe el motivo — es obligatorio.' }
  if (!input.delta) return { ok: false, error: 'La cantidad no puede ser cero.' }
  if (hasSupabase) {
    const r = await runW1Command('ajustar_lote', {
      p_op_id: input.op_id, p_lot: input.lot_id, p_delta: input.delta, p_kind: input.kind,
      p_reason: input.reason.trim(), p_receipt_id: input.receipt_id ?? undefined,
    }, input.op_id)
    if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
    await Promise.all([lotsLive.reload(), movsLive.reload()]); refreshStock()
    return { ok: true, status: r.status }
  }
  const cur = lotsLive.current().find((l) => l.id === input.lot_id)
  if (!cur) return { ok: false, error: 'No se encontró el lote.' }
  if (input.delta < 0 && cur.quantity + input.delta < 0) return { ok: false, error: 'No hay existencia suficiente en el lote.' }
  adjust(input.lot_id, input.delta, input.kind, input.reason.trim())
  return { ok: true, status: 'applied' }
}

// Ajuste de un lote (baja por merma/caducidad o reingreso). Registra el movimiento.
export function adjust(lotId: string, delta: number, reason: string, reference = '') {
  if (hasSupabase) throw new Error(W1_DIRECT_DISABLED)
  const cur = lotsLive.current().find((l) => l.id === lotId)
  const newQty = Math.max(0, (cur?.quantity ?? 0) + delta)
  seq += 1
  lotsLive.setLocal(lotsLive.current().map((l) => (l.id === lotId ? { ...l, quantity: newQty } : l)))
  movsLive.setLocal([{ id: `m-${seq}`, lot_id: lotId, change: delta, reason, reference, created_by: null, created_at: nowIso() }, ...movsLive.current()])
  refreshStock(lotsLive.current())
}

// Reingresa a SUS lotes las salidas registradas con una referencia (cancelación).
export function restockByReference(reference: string, reason = 'cancelacion'): void {
  if (hasSupabase) throw new Error(W1_DIRECT_DISABLED)
  const outs = movsLive.current().filter((m) => m.reference === reference && m.change < 0 && (m.reason === 'surtido' || m.reason === 'venta'))
  if (outs.length === 0) return
  const now = nowIso()
  const newMovs: InventoryMovement[] = []
  let lots = lotsLive.current()
  outs.forEach((m, i) => {
    const give = -m.change
    lots = lots.map((l) => (l.id === m.lot_id ? { ...l, quantity: l.quantity + give } : l))
    seq += 1
    newMovs.push({ id: `m-${seq}-r${i}`, lot_id: m.lot_id, change: give, reason, reference, created_by: null, created_at: now })
  })
  lotsLive.setLocal(lots)
  movsLive.setLocal([...newMovs, ...movsLive.current()])
  refreshStock(lotsLive.current())
}

// Consumir lotes (salida): decrementa y registra un movimiento por lote.
// `localOnly`: solo actualiza el cache (sin escribir a Supabase) — lo usa el surtido
// atómico, que persiste todo (lotes+pedido) en UNA sola RPC (surtir_pedido).
export function consume(allocations: { lot_id: string; qty: number }[], reference: string, reason = 'surtido', localOnly = false) {
  if (hasSupabase && !localOnly) throw new Error(W1_DIRECT_DISABLED)
  const now = nowIso()
  const affected = new Set<string>()
  allocations.forEach((a) => { const lot = lotsLive.current().find((l) => l.id === a.lot_id); if (lot) affected.add(lot.product_id) })
  const before = totalsFor(affected)
  lotsLive.setLocal(lotsLive.current().map((l) => {
    const alloc = allocations.find((a) => a.lot_id === l.id)
    return alloc ? { ...l, quantity: Math.max(0, l.quantity - alloc.qty) } : l
  }))
  const newMovs = allocations.map((a, i) => ({ id: `m-${seq + i + 1}`, lot_id: a.lot_id, change: -a.qty, reason, reference, created_by: null, created_at: now }))
  seq += allocations.length
  movsLive.setLocal([...newMovs, ...movsLive.current()])
  flagLowStock(before, affected)
  refreshStock(lotsLive.current())
}

// Recarga lotes+movimientos+stock tras una escritura externa (p. ej. surtir_pedido RPC).
export function reloadInventory() { if (hasSupabase) { lotsLive.reload(); movsLive.reload(); refreshStock() } }

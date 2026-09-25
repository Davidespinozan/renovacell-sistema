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
  const [lotsRes, costsRes] = await Promise.all([
    supabase.from('lots').select('id, product_id, lot_code, manufacture_date, expiry_date, quantity, location, metadata'),
    supabase.from('product_costs').select('product_id, unit_cost'),
  ])
  if (lotsRes.error) throw lotsRes.error
  const costMap = new Map<string, number>((costsRes.data ?? []).map((c) => [c.product_id as string, Number(c.unit_cost) || 0]))
  const mapped = (lotsRes.data ?? []).map((l) => ({
    id: l.id, product_id: l.product_id ?? '', lot_code: l.lot_code,
    manufacture_date: l.manufacture_date, expiry_date: l.expiry_date, quantity: l.quantity,
    location: l.location, unit_cost: costMap.get(l.product_id ?? '') ?? 0, metadata: (l.metadata ?? null) as Lot['metadata'],
  }))
  flagExpiring(mapped) // avisa de lotes por caducar / caducados al cargar inventario
  return mapped
}, lotsFallback)

const movsLive = makeLive<InventoryMovement>(async () => {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('id, lot_id, change, reason, reference, created_by, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((m) => ({
    id: m.id, lot_id: m.lot_id ?? '', change: m.change, reason: m.reason ?? '',
    reference: m.reference, created_by: m.created_by, created_at: m.created_at ?? '',
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

export interface ReceiveInput extends EntryInput {
  reason?: string
  reference?: string | null
  replenishment_id?: string | null // si se pasa, la RPC marca la compra 'recibida' en la misma tx
}

// RECEPCIÓN/ENTRADA ATÓMICA (Fase 1). Backend: RPC `recibir_lote` (crea/suma lote +
// movimiento + costo congelado, y opcionalmente marca la compra recibida en UNA
// transacción → sin el estado inconsistente "stock arriba pero compra pendiente").
// Mock: upsert-or-create local con promedio ponderado (blendedLotCost) + movimiento.
// Devuelve {ok} con error real (no console.warn silencioso).
export async function recibirLote(input: ReceiveInput): Promise<{ ok: boolean; error?: string; lot_id?: string }> {
  const reason = (input.reason ?? '').trim() || 'entrada'
  const reference = input.reference ?? input.lot_code
  if (!input.product_id || !(input.lot_code ?? '').trim()) return { ok: false, error: 'Falta producto o lote.' }
  if (!(input.quantity > 0)) return { ok: false, error: 'La cantidad debe ser mayor que 0.' }
  const inc = input.unit_cost ?? null

  if (hasSupabase) {
    const { data, error } = await supabase.rpc('recibir_lote' as never, {
      p_product: input.product_id, p_lote: input.lot_code, p_caducidad: input.expiry_date ?? null,
      p_cantidad: input.quantity, p_ubicacion: input.location ?? null, p_unit_cost: inc,
      p_reason: reason, p_reference: reference, p_replenishment_id: input.replenishment_id ?? null,
    } as never) as unknown as { data: { lot_id?: string } | null; error: { message: string } | null }
    if (error) return { ok: false, error: error.message }
    await Promise.all([lotsLive.reload(), movsLive.reload()]); refreshStock()
    return { ok: true, lot_id: data?.lot_id }
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
  void recibirLote(input)
}

// Ajuste de un lote (baja por merma/caducidad o reingreso). Registra el movimiento.
export function adjust(lotId: string, delta: number, reason: string, reference = '') {
  const cur = lotsLive.current().find((l) => l.id === lotId)
  const newQty = Math.max(0, (cur?.quantity ?? 0) + delta)
  seq += 1
  lotsLive.setLocal(lotsLive.current().map((l) => (l.id === lotId ? { ...l, quantity: newQty } : l)))
  movsLive.setLocal([{ id: `m-${seq}`, lot_id: lotId, change: delta, reason, reference, created_by: null, created_at: nowIso() }, ...movsLive.current()])
  refreshStock(lotsLive.current())
  if (hasSupabase && /^[0-9a-f]{8}-/i.test(lotId)) {
    supabase.rpc('apply_lot_movement', { p_lot: lotId, p_change: delta, p_reason: reason, p_reference: reference }).then(({ error }) => { if (error) console.warn('[lots] adjust', error.message); lotsLive.reload(); movsLive.reload(); refreshStock() })
  }
}

// Reingresa a SUS lotes las salidas registradas con una referencia (cancelación).
export function restockByReference(reference: string, reason = 'cancelacion'): void {
  const outs = movsLive.current().filter((m) => m.reference === reference && m.change < 0 && (m.reason === 'surtido' || m.reason === 'venta'))
  if (outs.length === 0) return
  const now = nowIso()
  const newMovs: InventoryMovement[] = []
  let lots = lotsLive.current()
  const rpcs: { lot: string; give: number }[] = []
  outs.forEach((m, i) => {
    const give = -m.change
    lots = lots.map((l) => (l.id === m.lot_id ? { ...l, quantity: l.quantity + give } : l))
    seq += 1
    newMovs.push({ id: `m-${seq}-r${i}`, lot_id: m.lot_id, change: give, reason, reference, created_by: null, created_at: now })
    if (hasSupabase && /^[0-9a-f]{8}-/i.test(m.lot_id)) rpcs.push({ lot: m.lot_id, give })
  })
  lotsLive.setLocal(lots)
  movsLive.setLocal([...newMovs, ...movsLive.current()])
  refreshStock(lotsLive.current())
  if (hasSupabase) {
    // ESPERA a que persistan los reingresos ANTES de recargar (si no, la recarga
    // revierte la UI a las cantidades pre-restock hasta la siguiente hidratación).
    (async () => {
      for (const r of rpcs) {
        const { error } = await supabase.rpc('apply_lot_movement', { p_lot: r.lot, p_change: r.give, p_reason: reason, p_reference: reference })
        if (error) console.warn('[lots] restock', error.message)
      }
      lotsLive.reload(); movsLive.reload(); refreshStock()
    })()
  }
}

// Consumir lotes (salida): decrementa y registra un movimiento por lote.
// `localOnly`: solo actualiza el cache (sin escribir a Supabase) — lo usa el surtido
// atómico, que persiste todo (lotes+pedido) en UNA sola RPC (surtir_pedido).
export function consume(allocations: { lot_id: string; qty: number }[], reference: string, reason = 'surtido', localOnly = false) {
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
  if (hasSupabase && !localOnly) {
    (async () => {
      // RPC atómico por lote: evita el lost-update del read-modify-write.
      for (const a of allocations) {
        if (/^[0-9a-f]{8}-/i.test(a.lot_id)) await supabase.rpc('apply_lot_movement', { p_lot: a.lot_id, p_change: -a.qty, p_reason: reason, p_reference: reference })
      }
      lotsLive.reload(); movsLive.reload(); refreshStock()
    })()
  }
}

// Recarga lotes+movimientos+stock tras una escritura externa (p. ej. surtir_pedido RPC).
export function reloadInventory() { if (hasSupabase) { lotsLive.reload(); movsLive.reload(); refreshStock() } }

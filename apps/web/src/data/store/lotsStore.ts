// Store compartido de lotes + ledger de movimientos (mock).
// Trazabilidad COFEPRIS: cada entrada/salida queda como inventory_movement por
// lote y los movimientos son INMUTABLES (solo se agregan). Al migrar a Supabase:
// insert en inventory_movements + update de lots; los hooks no cambian.
import type { Lot, InventoryMovement } from '../types'
import { MOCK_LOTS, MOCK_MOVEMENTS } from '../mock/inventory'
import { notify } from './notificationsStore'
import { getSnapshot as productsSnapshot } from './productsStore'

const LOW_STOCK_REORDER = 20 // umbral para avisar a Dirección que hay que reabastecer

// Total disponible (todos los lotes) de los productos indicados.
function totalsFor(ids: Set<string>): Record<string, number> {
  const m: Record<string, number> = {}
  lots.forEach((l) => { if (ids.has(l.product_id)) m[l.product_id] = (m[l.product_id] ?? 0) + l.quantity })
  return m
}
// Avisa a Dirección (campana) cuando un producto CRUZA el umbral de stock bajo.
function flagLowStock(before: Record<string, number>, ids: Set<string>) {
  const after = totalsFor(ids)
  const names = Object.fromEntries(productsSnapshot().map((p) => [p.id, p.name]))
  ids.forEach((pid) => {
    const b = before[pid] ?? 0, a = after[pid] ?? 0
    if (b > LOW_STOCK_REORDER && a <= LOW_STOCK_REORDER) {
      notify({ text: a <= 0 ? `Agotado: ${names[pid] ?? 'producto'} · reabastece` : `Stock bajo: ${names[pid] ?? 'producto'} (${a} u) · reabastece`, roles: ['admin'], screen: 'av_inv' })
    }
  })
}

let lots: Lot[] = [...MOCK_LOTS]
let movements: InventoryMovement[] = [...MOCK_MOVEMENTS]
let seq = 1000

const listeners = new Set<() => void>()

let snapshotLots: Lot[] = [...lots]
let snapshotMovements: InventoryMovement[] = sortDesc(movements)

function sortDesc(m: InventoryMovement[]): InventoryMovement[] {
  return [...m].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

function emit() {
  snapshotLots = [...lots]
  snapshotMovements = sortDesc(movements)
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const getSnapshotLots = (): Lot[] => snapshotLots
export const getSnapshotMovements = (): InventoryMovement[] => snapshotMovements

export interface EntryInput {
  product_id: string
  lot_code: string
  expiry_date: string | null
  quantity: number
  location: string | null
}

// Registrar entrada: crea un lote nuevo y su movimiento (+cantidad).
export function addEntry(input: EntryInput): Lot {
  seq += 1
  const lot: Lot = {
    id: `l-${seq}`,
    product_id: input.product_id,
    lot_code: input.lot_code,
    manufacture_date: null,
    expiry_date: input.expiry_date,
    quantity: input.quantity,
    location: input.location,
    metadata: null,
  }
  const mov: InventoryMovement = {
    id: `m-${seq}`,
    lot_id: lot.id,
    change: input.quantity,
    reason: 'entrada',
    reference: input.lot_code,
    created_by: null,
    created_at: new Date().toISOString(),
  }
  lots = [...lots, lot]
  movements = [...movements, mov]
  emit()
  return lot
}

// Ajuste de un lote: delta negativo (baja por caducidad/merma/conteo) o positivo
// (reingreso por cancelación/devolución). Registra el movimiento (trazabilidad).
export function adjust(lotId: string, delta: number, reason: string, reference = '') {
  seq += 1
  lots = lots.map((l) => (l.id === lotId ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l))
  movements = [...movements, {
    id: `m-${seq}`, lot_id: lotId, change: delta, reason, reference, created_by: null, created_at: new Date().toISOString(),
  }]
  emit()
}

// Consumir lotes (salida). Decrementa y registra un movimiento por lote.
// `reason`: 'surtido' (Almacén) | 'venta' (POS) | etc.
export function consume(allocations: { lot_id: string; qty: number }[], reference: string, reason = 'surtido') {
  const now = new Date().toISOString()
  // Productos afectados + su stock ANTES (para detectar cruce de umbral).
  const affected = new Set<string>()
  allocations.forEach((a) => { const lot = lots.find((l) => l.id === a.lot_id); if (lot) affected.add(lot.product_id) })
  const before = totalsFor(affected)
  const newMovs: InventoryMovement[] = []
  lots = lots.map((l) => {
    const alloc = allocations.find((a) => a.lot_id === l.id)
    if (!alloc) return l
    return { ...l, quantity: Math.max(0, l.quantity - alloc.qty) }
  })
  allocations.forEach((a, i) => {
    seq += 1
    newMovs.push({
      id: `m-${seq}-${i}`,
      lot_id: a.lot_id,
      change: -a.qty,
      reason,
      reference,
      created_by: null,
      created_at: now,
    })
  })
  movements = [...movements, ...newMovs]
  emit()
  flagLowStock(before, affected)
}

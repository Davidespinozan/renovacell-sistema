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

const LOW_STOCK_REORDER = 20

function sortDesc(m: InventoryMovement[]): InventoryMovement[] {
  return [...m].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

const lotsFallback: Lot[] = MOCK_LOTS.map((l) => ({ ...l, unit_cost: l.unit_cost ?? costOf(l.product_id) }))
const movsFallback: InventoryMovement[] = sortDesc(MOCK_MOVEMENTS)

const lotsLive = makeLive<Lot>(async () => {
  const { data, error } = await supabase
    .from('lots')
    .select('id, product_id, lot_code, manufacture_date, expiry_date, quantity, location, metadata')
  if (error) throw error
  return (data ?? []).map((l) => ({
    id: l.id, product_id: l.product_id ?? '', lot_code: l.lot_code,
    manufacture_date: l.manufacture_date, expiry_date: l.expiry_date, quantity: l.quantity,
    location: l.location, unit_cost: costOf(l.product_id ?? ''), metadata: (l.metadata ?? null) as Lot['metadata'],
  }))
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
      notify({ text: a <= 0 ? `Agotado: ${names[pid] ?? 'producto'} · reabastece` : `Stock bajo: ${names[pid] ?? 'producto'} (${a} u) · reabastece`, roles: ['admin'], screen: 'av_inv' })
    }
  })
}

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

// Registrar entrada: crea un lote nuevo y su movimiento (+cantidad).
export function addEntry(input: EntryInput): Lot {
  seq += 1
  const lot: Lot = {
    id: `l-${seq}`, product_id: input.product_id, lot_code: input.lot_code,
    manufacture_date: null, expiry_date: input.expiry_date, quantity: input.quantity,
    location: input.location, unit_cost: input.unit_cost ?? costOf(input.product_id), metadata: null,
  }
  const mov: InventoryMovement = {
    id: `m-${seq}`, lot_id: lot.id, change: input.quantity, reason: 'entrada',
    reference: input.lot_code, created_by: null, created_at: nowIso(),
  }
  lotsLive.setLocal([...lotsLive.current(), lot])
  movsLive.setLocal([mov, ...movsLive.current()])
  if (hasSupabase) {
    (async () => {
      const ins = await supabase.from('lots').insert({
        product_id: input.product_id, lot_code: input.lot_code, expiry_date: input.expiry_date,
        quantity: input.quantity, location: input.location,
      }).select('id').single()
      if (ins.error) { console.warn('[lots] entrada', ins.error.message); return }
      await supabase.from('inventory_movements').insert({ lot_id: ins.data.id, change: input.quantity, reason: 'entrada', reference: input.lot_code })
      lotsLive.reload(); movsLive.reload()
    })()
  }
  return lot
}

// Ajuste de un lote (baja por merma/caducidad o reingreso). Registra el movimiento.
export function adjust(lotId: string, delta: number, reason: string, reference = '') {
  const cur = lotsLive.current().find((l) => l.id === lotId)
  const newQty = Math.max(0, (cur?.quantity ?? 0) + delta)
  seq += 1
  lotsLive.setLocal(lotsLive.current().map((l) => (l.id === lotId ? { ...l, quantity: newQty } : l)))
  movsLive.setLocal([{ id: `m-${seq}`, lot_id: lotId, change: delta, reason, reference, created_by: null, created_at: nowIso() }, ...movsLive.current()])
  if (hasSupabase) {
    (async () => {
      await supabase.from('lots').update({ quantity: newQty }).eq('id', lotId)
      await supabase.from('inventory_movements').insert({ lot_id: lotId, change: delta, reason, reference })
      lotsLive.reload(); movsLive.reload()
    })()
  }
}

// Reingresa a SUS lotes las salidas registradas con una referencia (cancelación).
export function restockByReference(reference: string, reason = 'cancelacion'): void {
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
    if (hasSupabase) {
      (async () => {
        const cur = (await supabase.from('lots').select('quantity').eq('id', m.lot_id).single()).data
        if (cur) await supabase.from('lots').update({ quantity: cur.quantity + give }).eq('id', m.lot_id)
        await supabase.from('inventory_movements').insert({ lot_id: m.lot_id, change: give, reason, reference })
      })()
    }
  })
  lotsLive.setLocal(lots)
  movsLive.setLocal([...newMovs, ...movsLive.current()])
  if (hasSupabase) { lotsLive.reload(); movsLive.reload() }
}

// Consumir lotes (salida): decrementa y registra un movimiento por lote.
export function consume(allocations: { lot_id: string; qty: number }[], reference: string, reason = 'surtido') {
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
  if (hasSupabase) {
    (async () => {
      for (const a of allocations) {
        const cur = (await supabase.from('lots').select('quantity').eq('id', a.lot_id).single()).data
        if (cur) await supabase.from('lots').update({ quantity: Math.max(0, cur.quantity - a.qty) }).eq('id', a.lot_id)
        await supabase.from('inventory_movements').insert({ lot_id: a.lot_id, change: -a.qty, reason, reference })
      }
      lotsLive.reload(); movsLive.reload()
    })()
  }
}

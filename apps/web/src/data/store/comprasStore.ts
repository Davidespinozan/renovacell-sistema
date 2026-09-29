// Reabastecimiento (Dirección). Con backend lee/escribe `replenishments` (RLS:
// admin/billing crean; almacén recibe; admin paga). COMPRA a proveedor o
// PRODUCCIÓN interna. Almacén luego RECIBE y da de alta el lote (Entradas).
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import { makeLive } from './live'
import { runW1Command } from '../ops/w1Command'

export type ReplenKind = 'compra' | 'produccion'
// W1: recepción parcial y acumulada; 'recibida' y 'cerrada_incompleta' son terminales (no se reabren).
export type ReplenStatus = 'pendiente' | 'parcial' | 'recibida' | 'cerrada_incompleta'

export interface PurchaseOrder {
  id: string
  product_id: string
  product_name: string
  qty: number
  unit_cost: number
  kind: ReplenKind
  supplier: string | null
  status: ReplenStatus
  paid: boolean
  created_at: string
  received_qty?: number          // acumulado recibido (lo mantiene el servidor)
  close_reason?: string | null
}
// Pendiente por recibir de una orden (lo que aún admite recepción).
export const pendingQty = (o: PurchaseOrder): number => Math.max(0, o.qty - (o.received_qty ?? 0))
export const isOpen = (o: PurchaseOrder): boolean => o.status === 'pendiente' || o.status === 'parcial'

const isUuid = (s: string | null | undefined): boolean => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

const live = makeLive<PurchaseOrder>(async () => {
  const { data, error } = await supabase.from('replenishments')
    .select('id, product_id, product_name, qty, unit_cost, kind, supplier, status, paid, created_at, received_qty, close_reason')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as PurchaseOrder[]
}, [])

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot
// Recarga la lista de compras (tras una recepción atómica que marcó 'recibida' en el server).
export const reloadCompras = (): void => { void live.reload() }
// Modo demo (sin backend): refleja una recepción en el cache local con el mismo acumulado que el servidor.
export function markReceivedLocal(id: string, qty?: number): void {
  live.setLocal(live.current().map((o) => {
    if (o.id !== id) return o
    const rec = Math.min(o.qty, (o.received_qty ?? 0) + (qty ?? o.qty - (o.received_qty ?? 0)))
    return { ...o, received_qty: rec, status: rec >= o.qty ? 'recibida' : 'parcial' }
  }))
}

// Dirección cierra una orden incompleta (terminal; el faltante va en una orden nueva).
export async function cerrarOrdenCompra(opId: string, id: string, reason: string): Promise<{ ok: boolean; error?: string; ambiguous?: boolean }> {
  if (!reason.trim()) return { ok: false, error: 'Escribe el motivo — es obligatorio.' }
  if (!hasSupabase) {
    live.setLocal(live.current().map((o) => (o.id === id && isOpen(o) ? { ...o, status: 'cerrada_incompleta', close_reason: reason.trim() } : o)))
    return { ok: true }
  }
  const r = await runW1Command('cerrar_orden_compra', { p_op_id: opId, p_replenishment: id, p_reason: reason.trim() }, opId)
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
  await live.reload()
  const po = live.current().find((o) => o.id === id)
  if (po) logAudit({ actor: 'Dirección', action: 'Orden cerrada incompleta', resource: po.product_name, detail: reason.trim() })
  return { ok: true }
}

let seq = 0
export function createReplenishment(input: { product_id: string; product_name: string; qty: number; unit_cost: number; kind: ReplenKind; supplier?: string | null }): PurchaseOrder {
  seq += 1
  const po: PurchaseOrder = {
    id: hasSupabase ? (globalThis.crypto?.randomUUID?.() ?? `po-${seq}`) : `po-${seq}`,
    product_id: input.product_id, product_name: input.product_name, qty: input.qty, unit_cost: input.unit_cost,
    kind: input.kind, supplier: input.kind === 'compra' ? (input.supplier ?? null) : null,
    status: 'pendiente', paid: input.kind !== 'compra', created_at: new Date().toISOString(), received_qty: 0,
  }
  live.setLocal([po, ...live.current()])
  const verbo = input.kind === 'compra' ? 'Compra' : 'Producción'
  notify({ text: `${verbo} por recibir: ${input.product_name} ×${input.qty}`, roles: ['warehouse'], screen: 'compras' })
  logAudit({ actor: 'Dirección', action: input.kind === 'compra' ? 'Compra a proveedor' : 'Orden de producción', resource: input.product_name, detail: `×${input.qty}${po.supplier ? ` · ${po.supplier}` : ''}` })
  if (hasSupabase) {
    supabase.from('replenishments').insert({
      id: po.id, product_id: isUuid(input.product_id) ? input.product_id : null, product_name: input.product_name,
      qty: input.qty, unit_cost: input.unit_cost, kind: input.kind, supplier: po.supplier, status: 'pendiente', paid: po.paid, created_by: currentUserId(),
    }).then(({ error }) => { if (error) console.warn('[replenishments] insert', error.message); live.reload() })
  }
  return po
}

// Modo demo: marca la orden como recibida por completo. Con backend el estado y el
// acumulado los mantiene SOLO el servidor (recibir_lote / cerrar_orden_compra).
export function markReceived(id: string) {
  if (hasSupabase) return
  const po = live.current().find((o) => o.id === id)
  live.setLocal(live.current().map((o) => (o.id === id ? { ...o, status: 'recibida', received_qty: o.qty } : o)))
  if (po) logAudit({ actor: 'Almacén', action: 'Reabastecimiento recibido', resource: po.product_name, detail: `×${po.qty}` })
}

export function markPaid(id: string) {
  const po = live.current().find((o) => o.id === id)
  live.setLocal(live.current().map((o) => (o.id === id ? { ...o, paid: true } : o)))
  if (po) logAudit({ actor: 'Dirección', action: 'Pago a proveedor', resource: po.product_name, detail: `$${po.unit_cost * po.qty}${po.supplier ? ` · ${po.supplier}` : ''}` })
  if (hasSupabase && isUuid(id)) supabase.from('replenishments').update({ paid: true }).eq('id', id).then(({ error }) => { if (error) console.warn('[replenishments] paid', error.message); live.reload() })
}

// Reabastecimiento (Dirección). Con backend lee/escribe `replenishments` (RLS:
// admin/billing crean; almacén recibe; admin paga). COMPRA a proveedor o
// PRODUCCIÓN interna. Almacén luego RECIBE y da de alta el lote (Entradas).
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import { makeLive } from './live'

export type ReplenKind = 'compra' | 'produccion'
export type ReplenStatus = 'pendiente' | 'recibida'

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
}

const isUuid = (s: string | null | undefined): boolean => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

const live = makeLive<PurchaseOrder>(async () => {
  const { data, error } = await supabase.from('replenishments')
    .select('id, product_id, product_name, qty, unit_cost, kind, supplier, status, paid, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as PurchaseOrder[]
}, [])

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

let seq = 0
export function createReplenishment(input: { product_id: string; product_name: string; qty: number; unit_cost: number; kind: ReplenKind; supplier?: string | null }): PurchaseOrder {
  seq += 1
  const po: PurchaseOrder = {
    id: hasSupabase ? (globalThis.crypto?.randomUUID?.() ?? `po-${seq}`) : `po-${seq}`,
    product_id: input.product_id, product_name: input.product_name, qty: input.qty, unit_cost: input.unit_cost,
    kind: input.kind, supplier: input.kind === 'compra' ? (input.supplier ?? null) : null,
    status: 'pendiente', paid: input.kind !== 'compra', created_at: new Date().toISOString(),
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

export function markReceived(id: string) {
  const po = live.current().find((o) => o.id === id)
  live.setLocal(live.current().map((o) => (o.id === id ? { ...o, status: 'recibida' } : o)))
  if (po) logAudit({ actor: 'Almacén', action: 'Reabastecimiento recibido', resource: po.product_name, detail: `×${po.qty}` })
  if (hasSupabase && isUuid(id)) supabase.from('replenishments').update({ status: 'recibida' }).eq('id', id).then(({ error }) => { if (error) console.warn('[replenishments] received', error.message); live.reload() })
}

export function markPaid(id: string) {
  const po = live.current().find((o) => o.id === id)
  live.setLocal(live.current().map((o) => (o.id === id ? { ...o, paid: true } : o)))
  if (po) logAudit({ actor: 'Dirección', action: 'Pago a proveedor', resource: po.product_name, detail: `$${po.unit_cost * po.qty}${po.supplier ? ` · ${po.supplier}` : ''}` })
  if (hasSupabase && isUuid(id)) supabase.from('replenishments').update({ paid: true }).eq('id', id).then(({ error }) => { if (error) console.warn('[replenishments] paid', error.message); live.reload() })
}

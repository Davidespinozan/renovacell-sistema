// Compras / Reabastecimiento (Logística). Órdenes de compra a proveedor. Mock hoy;
// con Supabase = tabla purchase_orders. Cierra el dolor "gestión de compras y
// reabastecimiento". El alta de inventario real al recibir se hace en Almacén →
// Entradas (genera el lote con caducidad), aquí solo se marca la recepción.
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'

export type PurchaseStatus = 'solicitada' | 'recibida'
export interface PurchaseOrder {
  id: string
  product_id: string
  product_name: string
  qty: number
  status: PurchaseStatus
  created_at: string
}

let orders: PurchaseOrder[] = []
let seq = 0
const listeners = new Set<() => void>()
let snapshot: PurchaseOrder[] = []

function emit() {
  snapshot = [...orders]
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): PurchaseOrder[] => snapshot

export function createPurchase(input: { product_id: string; product_name: string; qty: number }): PurchaseOrder {
  seq += 1
  const po: PurchaseOrder = { id: `po-${seq}`, ...input, status: 'solicitada', created_at: new Date().toISOString() }
  orders = [po, ...orders]
  emit()
  notify({ text: `Compra solicitada: ${input.product_name} ×${input.qty}`, roles: ['admin'], screen: 'av_inv' })
  logAudit({ actor: 'Almacén', action: 'Compra solicitada', resource: input.product_name, detail: `×${input.qty}` })
  return po
}

export function markReceived(id: string) {
  const po = orders.find((o) => o.id === id)
  orders = orders.map((o) => (o.id === id ? { ...o, status: 'recibida' } : o))
  emit()
  if (po) logAudit({ actor: 'Almacén', action: 'Compra recibida', resource: po.product_name, detail: `×${po.qty}` })
}

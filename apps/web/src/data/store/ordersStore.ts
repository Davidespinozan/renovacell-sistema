// Store compartido de pedidos (mock). Un solo origen para que el ciclo conecte:
// el Portal crea el pedido y Almacén lo surte (cambia su estatus); ambos lo ven.
// Doctor ve SUS pedidos (getSnapshot); staff (almacén) ve TODOS (getSnapshotAll).
// Al migrar a Supabase: queries + RLS; los hooks mantienen su firma.
import type { Order, OrderItem } from '../types'
import { DOCTOR_ID, MOCK_ORDERS, MOCK_ORDER_ITEMS } from '../mock/orders'

export interface OrderWithItems extends Order {
  items: OrderItem[]
}

export interface NewOrderLine {
  product_id: string
  qty: number
  unit_price: number | null // null = cotización
}

let orders: Order[] = [...MOCK_ORDERS]
let items: OrderItem[] = [...MOCK_ORDER_ITEMS]
let folioSeq = 3800

const listeners = new Set<() => void>()

function withItems(list: Order[]): OrderWithItems[] {
  return list
    .map((o) => ({ ...o, items: items.filter((it) => it.order_id === o.id) }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

let snapshotDoctor: OrderWithItems[] = withItems(orders.filter((o) => o.doctor_id === DOCTOR_ID))
let snapshotAll: OrderWithItems[] = withItems(orders)

function emit() {
  snapshotDoctor = withItems(orders.filter((o) => o.doctor_id === DOCTOR_ID))
  snapshotAll = withItems(orders)
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const getSnapshot = (): OrderWithItems[] => snapshotDoctor
export const getSnapshotAll = (): OrderWithItems[] => snapshotAll

export function createOrder(input: {
  lines: NewOrderLine[]
  total: number
  invoice_requested: boolean
}): OrderWithItems {
  folioSeq += 1
  const id = `o-${folioSeq}`
  const folio = `S${folioSeq}`
  const now = new Date().toISOString()

  const order: Order = {
    id, external_ref: folio, doctor_id: DOCTOR_ID, total: input.total, currency: 'MXN',
    status: 'pending_payment', payment_method: 'contra_pedido', payment_ref: null,
    payment_status: 'pending', stripe_payment_id: null, invoice_requested: input.invoice_requested,
    invoice_meta: null, shipping_meta: null, created_at: now,
  }
  const newItems: OrderItem[] = input.lines.map((l, i) => ({
    id: `${id}-${i}`, order_id: id, product_id: l.product_id, lot_id: null,
    qty: l.qty, unit_price: l.unit_price, created_at: now,
  }))

  orders = [order, ...orders]
  items = [...items, ...newItems]
  emit()
  return { ...order, items: newItems }
}

// Surtido: marca el pedido como Empacado y asigna el lote surtido a cada renglón.
// (El descuento de lotes y los movimientos viven en lotsStore; ver ops/surtir.ts.)
export function markPacked(orderId: string, itemLot: Record<string, string | null>) {
  orders = orders.map((o) => (o.id === orderId ? { ...o, status: 'packed' } : o))
  items = items.map((it) =>
    it.order_id === orderId && itemLot[it.id] !== undefined ? { ...it, lot_id: itemLot[it.id] } : it,
  )
  emit()
}

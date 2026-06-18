// Store compartido de pedidos (mock). Un solo origen para que crear un pedido en
// el Catálogo se refleje en "Mis pedidos" (instancias distintas del hook).
// Al migrar a Supabase, esto se reemplaza por queries + realtime/revalidación;
// el hook useOrders mantiene su firma.
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

function build(): OrderWithItems[] {
  return orders
    .filter((o) => o.doctor_id === DOCTOR_ID)
    .map((o) => ({ ...o, items: items.filter((it) => it.order_id === o.id) }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

let snapshot: OrderWithItems[] = build()

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getSnapshot(): OrderWithItems[] {
  return snapshot
}

function emit() {
  snapshot = build()
  listeners.forEach((l) => l())
}

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
    id,
    external_ref: folio,
    doctor_id: DOCTOR_ID,
    total: input.total,
    currency: 'MXN',
    status: 'pending_payment', // "contra pedido": creado, pago se coordina después
    payment_method: 'contra_pedido',
    payment_ref: null,
    payment_status: 'pending',
    stripe_payment_id: null, // stub: sin Stripe todavía
    invoice_requested: input.invoice_requested,
    invoice_meta: null,
    shipping_meta: null,
    created_at: now,
  }

  const newItems: OrderItem[] = input.lines.map((l, i) => ({
    id: `${id}-${i}`,
    order_id: id,
    product_id: l.product_id,
    lot_id: null,
    qty: l.qty,
    unit_price: l.unit_price,
    created_at: now,
  }))

  orders = [order, ...orders]
  items = [...items, ...newItems]
  emit()
  return { ...order, items: newItems }
}

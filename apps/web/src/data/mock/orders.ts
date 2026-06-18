// Pedidos MOCK del doctor actual, con la forma de las tablas `orders` y
// `order_items` de packages/db/schema.sql. Los product_id referencian el
// catálogo mock (data/mock/catalog.ts).
//
// Convención: order_items.unit_price = null  -> renglón de COTIZACIÓN
// (producto profesional "a consultar"), no compra directa.
import type { Order, OrderItem } from '../types'

export const DOCTOR_ID = 'doctor-1'

export const MOCK_ORDERS: Order[] = [
  {
    id: 'o-3683', external_ref: 'S3683', doctor_id: DOCTOR_ID, total: 3670, currency: 'MXN',
    status: 'delivered', payment_method: 'contra_pedido', payment_ref: 'TR-3683',
    payment_status: 'paid', stripe_payment_id: null, invoice_requested: true,
    invoice_meta: null, shipping_meta: { carrier: 'Estafeta', tracking: '7790xx' },
    created_at: '2026-05-20T10:00:00Z',
  },
  {
    id: 'o-3559', external_ref: 'S3559', doctor_id: DOCTOR_ID, total: 1450, currency: 'MXN',
    status: 'shipped', payment_method: 'contra_pedido', payment_ref: 'TR-3559',
    payment_status: 'paid', stripe_payment_id: null, invoice_requested: false,
    invoice_meta: null, shipping_meta: { carrier: 'DHL', tracking: '4410xx' },
    created_at: '2026-06-10T09:30:00Z',
  },
  {
    id: 'o-3712', external_ref: 'S3712', doctor_id: DOCTOR_ID, total: 680, currency: 'MXN',
    status: 'pending_payment', payment_method: 'contra_pedido', payment_ref: null,
    payment_status: 'pending', stripe_payment_id: null, invoice_requested: true,
    invoice_meta: null, shipping_meta: null,
    created_at: '2026-06-17T16:45:00Z',
  },
]

export const MOCK_ORDER_ITEMS: OrderItem[] = [
  // S3683 (entregado)
  { id: 'oi-1', order_id: 'o-3683', product_id: 'p-mgp-90', lot_id: null, qty: 2, unit_price: 890, created_at: '2026-05-20T10:00:00Z' },
  { id: 'oi-2', order_id: 'o-3683', product_id: 'p-gs-114', lot_id: null, qty: 1, unit_price: 1890, created_at: '2026-05-20T10:00:00Z' },
  // S3559 (en camino)
  { id: 'oi-3', order_id: 'o-3559', product_id: 'p-ab-50', lot_id: null, qty: 1, unit_price: 1450, created_at: '2026-06-10T09:30:00Z' },
  // S3712 (pendiente de pago) — incluye una cotización (unit_price null)
  { id: 'oi-4', order_id: 'o-3712', product_id: 'p-pl-12', lot_id: null, qty: 1, unit_price: 680, created_at: '2026-06-17T16:45:00Z' },
  { id: 'oi-5', order_id: 'o-3712', product_id: 'p-gp-300', lot_id: null, qty: 1, unit_price: null, created_at: '2026-06-17T16:45:00Z' },
]

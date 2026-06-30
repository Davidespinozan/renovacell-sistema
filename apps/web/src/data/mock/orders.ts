// Pedidos MOCK del doctor actual, con la forma de las tablas `orders` y
// `order_items` de packages/db/schema.sql. Los product_id referencian el
// catálogo mock (data/mock/catalog.ts).
// Todos los renglones tienen precio (unit_price). Ya no existe el concepto de
// "cotización": cada producto del catálogo se vende a precio de lista.
import type { Order, OrderItem } from '../types'

export const DOCTOR_ID = 'doctor-1'

// Helper para ventas POS semilla (mostrador): entregadas y pagadas, canal pos.
const posOrder = (id: string, ref: string, total: number, pay: string, created_at: string): Order[] => [{
  id, external_ref: ref, doctor_id: null, total, currency: 'MXN',
  status: 'delivered', payment_method: pay, payment_ref: null, payment_status: 'paid',
  stripe_payment_id: null, invoice_requested: false, invoice_meta: null,
  shipping_meta: { channel: 'pos' }, created_at,
}]

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
    id: 'o-3712', external_ref: 'S3712', doctor_id: DOCTOR_ID, total: 7580, currency: 'MXN',
    status: 'pending_payment', payment_method: 'contra_pedido', payment_ref: null,
    payment_status: 'pending', stripe_payment_id: null, invoice_requested: true,
    invoice_meta: null, shipping_meta: null,
    created_at: '2026-06-17T16:45:00Z',
  },
  // ATORADO: surtido (Empacado) desde hace meses, sin envío asignado (caso S12840).
  {
    id: 'o-12840', external_ref: 'S12840', doctor_id: DOCTOR_ID, total: 3780, currency: 'MXN',
    status: 'packed', payment_method: 'contra_pedido', payment_ref: 'TR-12840',
    payment_status: 'paid', stripe_payment_id: null, invoice_requested: false,
    invoice_meta: null, shipping_meta: null,
    created_at: '2025-09-25T10:00:00Z',
  },
  // Asignado a CHOFER propio (drv-1) para entrega local — alimenta la vista del chofer.
  {
    id: 'o-3640', external_ref: 'S3640', doctor_id: DOCTOR_ID, total: 2670, currency: 'MXN',
    status: 'shipped', payment_method: 'contra_pedido', payment_ref: 'TR-3640',
    payment_status: 'paid', stripe_payment_id: null, invoice_requested: false,
    invoice_meta: null, shipping_meta: { method: 'chofer', driver: 'Chofer local Culiacán', driver_id: 'drv-1' },
    created_at: '2026-06-15T09:00:00Z',
  },
  // Ventas POS de mostrador (junio) — dan volumen real al P&L del mes.
  ...posOrder('pos-201', 'POS-201', 13800, 'efectivo', '2026-06-04T12:00:00Z'),
  ...posOrder('pos-202', 'POS-202', 16200, 'tarjeta', '2026-06-08T13:00:00Z'),
  ...posOrder('pos-203', 'POS-203', 19200, 'efectivo', '2026-06-11T11:30:00Z'),
  ...posOrder('pos-204', 'POS-204', 12600, 'tarjeta', '2026-06-17T16:00:00Z'),
  ...posOrder('pos-205', 'POS-205', 13800, 'efectivo', '2026-06-21T10:30:00Z'),
  ...posOrder('pos-206', 'POS-206', 7560, 'tarjeta', '2026-06-25T17:00:00Z'),
]

export const MOCK_ORDER_ITEMS: OrderItem[] = [
  // S3683 (entregado)
  { id: 'oi-1', order_id: 'o-3683', product_id: 'p-mgp-90', lot_id: null, qty: 2, unit_price: 890, created_at: '2026-05-20T10:00:00Z' },
  { id: 'oi-2', order_id: 'o-3683', product_id: 'p-gs-114', lot_id: null, qty: 1, unit_price: 1890, created_at: '2026-05-20T10:00:00Z' },
  // S3559 (en camino)
  { id: 'oi-3', order_id: 'o-3559', product_id: 'p-ab-50', lot_id: null, qty: 1, unit_price: 1450, created_at: '2026-06-10T09:30:00Z' },
  // S3712 (pendiente de pago)
  { id: 'oi-4', order_id: 'o-3712', product_id: 'p-pl-12', lot_id: null, qty: 1, unit_price: 680, created_at: '2026-06-17T16:45:00Z' },
  { id: 'oi-5', order_id: 'o-3712', product_id: 'p-gp-300', lot_id: null, qty: 1, unit_price: 6900, created_at: '2026-06-17T16:45:00Z' },
  // S12840 (atorado, surtido sin salir)
  { id: 'oi-6', order_id: 'o-12840', product_id: 'p-gs-114', lot_id: 'l-gs-1', qty: 2, unit_price: 1890, created_at: '2025-09-25T10:00:00Z' },
  // S3640 (chofer)
  { id: 'oi-7', order_id: 'o-3640', product_id: 'p-mgp-90', lot_id: 'l-mgp-a', qty: 3, unit_price: 890, created_at: '2026-06-15T09:00:00Z' },
  // Renglones de las ventas POS de junio (lot_id real → trazabilidad/COGS).
  { id: 'oi-201', order_id: 'pos-201', product_id: 'p-gp-300', lot_id: 'l-gp-300', qty: 2, unit_price: 6900, created_at: '2026-06-04T12:00:00Z' },
  { id: 'oi-202', order_id: 'pos-202', product_id: 'p-ufs-11', lot_id: 'l-ufs-11', qty: 3, unit_price: 5400, created_at: '2026-06-08T13:00:00Z' },
  { id: 'oi-203', order_id: 'pos-203', product_id: 'p-sac-21', lot_id: 'l-sac-21', qty: 4, unit_price: 4800, created_at: '2026-06-11T11:30:00Z' },
  { id: 'oi-204', order_id: 'pos-204', product_id: 'p-gv-07', lot_id: 'l-gv-07', qty: 3, unit_price: 4200, created_at: '2026-06-17T16:00:00Z' },
  { id: 'oi-205', order_id: 'pos-205', product_id: 'p-gp-300', lot_id: 'l-gp-300', qty: 2, unit_price: 6900, created_at: '2026-06-21T10:30:00Z' },
  { id: 'oi-206', order_id: 'pos-206', product_id: 'p-gs-114', lot_id: 'l-gs-1', qty: 4, unit_price: 1890, created_at: '2026-06-25T17:00:00Z' },
]

// Fábricas de datos para las pruebas (solo las importan los .test.ts → se excluyen
// del bundle). Valores por defecto sensatos + overrides parciales.
import type { OrderWithItems } from '../data/hooks/useOrders'
import type { Lot, InventoryMovement, Shipment, ProductSafe, Profile, OrderItem } from '../data/types'

export const mkOrder = (o: Partial<OrderWithItems> = {}): OrderWithItems => ({
  id: 'o1', external_ref: 'S1', doctor_id: 'd1', total: 1000, currency: 'MXN',
  status: 'delivered', payment_method: 'contra_pedido', payment_ref: null,
  payment_status: 'paid', stripe_payment_id: null, invoice_requested: false,
  invoice_meta: null, shipping_meta: null, created_at: '2026-06-01T10:00:00Z', items: [], ...o,
})

export const mkItem = (i: Partial<OrderItem> = {}): OrderItem => ({
  id: 'it1', order_id: 'o1', product_id: 'p1', lot_id: null, qty: 1, unit_price: 100,
  created_at: '2026-06-01T10:00:00Z', ...i,
})

export const mkLot = (l: Partial<Lot> = {}): Lot => ({
  id: 'l1', product_id: 'p1', lot_code: 'L-1', manufacture_date: null, expiry_date: '2099-12-31',
  quantity: 10, location: null, unit_cost: 0, metadata: null, ...l,
})

export const mkMov = (m: Partial<InventoryMovement> = {}): InventoryMovement => ({
  id: 'm1', lot_id: 'l1', change: -1, reason: 'surtido', reference: 'S1',
  created_by: null, created_at: '2026-06-01T10:00:00Z', ...m,
})

export const mkShipment = (s: Partial<Shipment> = {}): Shipment => ({
  id: 'sh1', order_id: 'o1', carrier: null, tracking_number: null, label_url: null,
  driver_id: null, status: 'out_for_delivery', estimated_delivery_at: null, delivered_at: null,
  proof_image_url: null, received_by: null, incident: null, created_at: '2026-06-01T10:00:00Z', ...s,
})

export const mkProduct = (p: Partial<ProductSafe> = {}): ProductSafe => ({
  id: 'p1', sku: 'SKU-1', name: 'Producto', line: 'cosm', category: null, description: null,
  price: 100, unit: null, image_url: null, active: true, ...p,
})

export const mkProfile = (p: Partial<Profile> = {}): Profile => ({
  id: 'd1', email: 'd1@x.mx', full_name: 'Dra. Uno', role_id: 'doctor',
  verified: true, organization: null, meta: {}, ...p,
})

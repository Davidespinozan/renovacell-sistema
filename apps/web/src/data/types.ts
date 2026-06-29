// Tipos que reflejan EXACTAMENTE las tablas de packages/db/schema.sql.
// Mantener los nombres de campo idénticos a la BD para que conectar Supabase
// después sea solo cambiar el origen de datos, no las pantallas.

export type UUID = string
export type ISODate = string      // 'YYYY-MM-DD'
export type ISODateTime = string  // timestamptz
export type Json = Record<string, unknown> | null

export type RoleId =
  | 'admin' | 'doctor' | 'warehouse' | 'pos' | 'driver'

export interface Role {
  id: RoleId
  description: string | null
}

export interface Profile {
  id: UUID
  email: string | null
  full_name: string | null
  role_id: RoleId | null
  verified: boolean
  organization: string | null
  meta: Json
}

export interface Product {
  id: UUID
  sku: string
  name: string
  line: string | null      // 'prof' | 'cosm'
  category: string | null
  description: string | null
  price: number | null     // null = "a consultar" (profesional)
  unit: string | null
  image_url: string | null // imagen real del producto (Storage en el futuro)
  metadata: Json           // interno (NO visible para no-admin)
}

// Forma de la vista segura `products_safe` (sin metadata/costo/proveedor).
// Es lo que leen doctor y staff; el catálogo del portal usa ESTE tipo.
export type ProductSafe = Omit<Product, 'metadata'>

export interface ProductCost {
  product_id: UUID
  unit_cost: number | null
  supplier: string | null
  notes: string | null
  metadata: Json
  updated_at: ISODateTime
}

export interface Lot {
  id: UUID
  product_id: UUID
  lot_code: string
  manufacture_date: ISODate | null
  expiry_date: ISODate | null
  quantity: number
  location: string | null
  metadata: Json
}

export interface InventoryMovement {
  id: UUID
  lot_id: UUID
  change: number
  reason: string | null
  reference: string | null
  created_by: UUID | null
  created_at: ISODateTime
}

export type OrderStatus =
  | 'draft' | 'pending_payment' | 'paid' | 'picking' | 'packed'
  | 'shipped' | 'delivered' | 'fulfilled' | 'cancelled'

export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed'

export interface Order {
  id: UUID
  external_ref: string | null
  doctor_id: UUID | null
  total: number | null
  currency: string            // default 'MXN'
  status: OrderStatus | null
  payment_method: string | null
  payment_ref: string | null
  payment_status: PaymentStatus | null
  stripe_payment_id: string | null
  invoice_requested: boolean
  invoice_meta: Json
  shipping_meta: Json
  created_at: ISODateTime
}

export interface OrderItem {
  id: UUID
  order_id: UUID
  product_id: UUID | null
  lot_id: UUID | null
  qty: number
  unit_price: number | null
  created_at: ISODateTime
}

export interface Shipment {
  id: UUID
  order_id: UUID
  carrier: string | null
  tracking_number: string | null
  driver_id: UUID | null
  status: string | null
  estimated_delivery_at: ISODateTime | null
  delivered_at: ISODateTime | null
  proof_image_url: string | null
  received_by: string | null    // nombre de quien recibió en destino (prueba de entrega)
  created_at: ISODateTime
}

export interface Prospect {
  id: UUID
  name: string | null
  email: string | null
  phone: string | null
  cedula: string | null
  source: string | null
  status: string | null
  assigned_to: UUID | null
  meta: Json
  created_at: ISODateTime
}

export interface Announcement {
  id: UUID
  title: string
  body: string | null
  start_at: ISODateTime | null
  end_at: ISODateTime | null
  created_by: UUID | null
  created_at: ISODateTime
  metadata: Json
}

export interface Asset {
  id: UUID
  key: string | null
  url: string | null
  uploaded_by: UUID | null
  tags: string[] | null
  metadata: Json
  created_at: ISODateTime
}

// --- Chat interno (tablas futuras: conversations / messages + realtime) ---
export interface Conversation {
  id: string
  kind: 'group' | 'dm'
  title: string | null      // título del grupo, o nombre del contacto en DM
  area: RoleId | null       // grupo por área (opcional)
  member_ids: string[]
  created_at: ISODateTime
  last_message_at: ISODateTime | null
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  sender_name: string | null
  body: string
  created_at: ISODateTime
}

// Estado estándar que devuelven los hooks de datos (igual con mock o Supabase).
export interface QueryResult<T> {
  data: T
  loading: boolean
  error: string | null
}

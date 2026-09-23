// ============================================================================
// Modelo logístico NEUTRAL AL PROVEEDOR (DHL ahora, T1 después). Ni el modelo ni
// los nombres de campo son específicos de un carrier: el adaptador de cada
// proveedor traduce ESTO a su contrato. Packing y el snapshot del pedido usan
// exactamente estos tipos, así que agregar T1 no reescribe Packing.
// ============================================================================
import type { ShippingAddress } from '../ops/shippingAddress'

export type { ShippingAddress }

// Paquete FÍSICO final (la caja armada en empaque), NO dimensiones del catálogo.
// Un pedido con varios productos se manda en una caja cuyo peso/medidas se capturan.
export interface LogisticsPackage {
  weightKg: number
  lengthCm: number
  widthCm: number
  heightCm: number
  pieces: number // número de bultos (>=1)
}

// Remitente operativo de Renovacell (de company_settings, reutilizable por DHL/T1).
export interface ShipperConfig {
  name: string        // razón social / remitente
  addressLine1: string
  cp: string
  city: string
  state: string
  country: string     // ISO-2 (p.ej. 'MX'); país operativo de config, no por-envío
  phone: string
  email: string
}

// Destinatario: nombre + (email opcional) + dirección snapshot del pedido.
export interface Receiver {
  name: string
  email?: string | null
  address: ShippingAddress
}

// Petición neutral que consume cualquier ShippingProvider (RateQuote/LabelResult
// viven en provider.ts, que es la frontera de transporte hacia la Edge Function).
export interface ShipmentRequest {
  orderRef: string
  idempotencyKey: string        // 1 intento = 1 clave; evita guías duplicadas
  shipper: ShipperConfig
  receiver: Receiver
  pkg: LogisticsPackage
}

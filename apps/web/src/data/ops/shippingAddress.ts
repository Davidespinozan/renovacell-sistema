// Dirección de ENTREGA. Regla de negocio (Renovacell): el cliente guarda un domicilio
// BASE al darlo de alta —es el default de envíos— y en CADA venta (portal o Ventas) se
// pregunta si el envío va a ese domicilio o a otro. La dirección elegida VIAJA con el
// pedido (`orders.shipping_meta.address`), y de ahí la leen la guía y el chofer — nunca
// más del perfil a ciegas (que dejaba direcciones "—, —" con doctores reales).
import type { Profile } from '../types'

export interface ShippingAddress {
  line1: string        // calle y número
  colonia?: string
  cp?: string          // código postal (obligatorio para cotizar/timbrar guía)
  city?: string
  state?: string
  refs?: string        // referencias / entre calles
  phone?: string       // teléfono de contacto de la entrega
}

// Texto legible en una línea (para tarjetas, ruta del chofer, seguimiento).
export function formatAddress(a?: ShippingAddress | null): string {
  if (!a) return ''
  return [a.line1, a.colonia, a.cp ? `C.P. ${a.cp}` : '', a.city, a.state]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

// ¿La dirección tiene lo mínimo para enviar? (calle + ciudad; CP para guía formal.)
export function isAddressUsable(a?: ShippingAddress | null): boolean {
  return !!a && a.line1.trim().length > 3 && (a.city ?? '').trim().length > 1
}

// Domicilio BASE del cliente. Nuevo modelo: `profiles.meta.shipping` (estructurado).
// Compatibilidad hacia atrás: si no existe, arma uno con los `meta.address`/`meta.city`
// sueltos que ya usaban el mock y la migración previa.
export function baseAddressOf(doctor?: Profile | null): ShippingAddress | null {
  const meta = (doctor?.meta ?? {}) as Record<string, unknown>
  const s = meta.shipping as ShippingAddress | undefined
  if (s && s.line1) return s
  const legacy = (meta.address as string | undefined)?.trim()
  if (legacy && legacy !== '—') {
    return { line1: legacy, city: (meta.city as string | undefined) ?? '', phone: (meta.phone as string | undefined) ?? '' }
  }
  return null
}

// Dirección de ENTREGA de un pedido: la que se guardó en el pedido; si el pedido es
// viejo (sin dirección propia), cae al domicilio base del cliente.
export function orderAddress(shippingMeta: unknown, doctor?: Profile | null): ShippingAddress | null {
  const a = (shippingMeta as { address?: ShippingAddress } | null)?.address
  if (a && a.line1) return a
  return baseAddressOf(doctor)
}
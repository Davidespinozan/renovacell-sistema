// Multi-ubicación de entrega (Fase 1) — helpers PUROS (sin red). Adaptan el catálogo
// `doctor_locations` al snapshot de envío del pedido y convierten el domicilio legacy.
// SOLO entrega: nunca tocan datos fiscales (meta.fiscal).
import type { Database } from '../database.types'
import type { ShippingAddress } from './shippingAddress'

export type DoctorLocation = Database['public']['Tables']['doctor_locations']['Row']
export type DoctorLocationInput = Database['public']['Tables']['doctor_locations']['Insert']

// Ubicación → estructura EXACTA de orders.shipping_meta.address (ShippingAddress), para que la
// fase 2 la copie tal cual al pedido y deliveryOf()/la guía la lean sin cambios.
export function locationToShippingAddress(loc: DoctorLocation): ShippingAddress {
  const line1 = [loc.line1, loc.exterior_number, loc.interior_number ? `Int. ${loc.interior_number}` : '']
    .map((s) => (s ?? '').trim()).filter(Boolean).join(' ')
  return {
    line1,
    colonia: loc.neighborhood ?? undefined,
    cp: loc.postal_code || undefined,
    city: loc.city || undefined,
    state: loc.state || undefined,
    refs: loc.reference_notes ?? undefined,
    phone: loc.contact_phone ?? undefined,
  }
}

// Domicilio legacy (profiles.meta.shipping) → campos de doctor_locations para un futuro backfill.
// NO modifica meta.shipping; solo produce la representación. Devuelve null si no hay calle.
export function legacyShippingToLocation(shipping: ShippingAddress | null | undefined, doctorId: string, name = 'Principal'): DoctorLocationInput | null {
  if (!shipping || !shipping.line1?.trim()) return null
  return {
    doctor_id: doctorId,
    name,
    line1: shipping.line1.trim(),
    neighborhood: shipping.colonia ?? null,
    postal_code: (shipping.cp ?? '').trim(),
    city: (shipping.city ?? '').trim(),
    state: (shipping.state ?? '').trim(),
    reference_notes: shipping.refs ?? null,
    contact_phone: shipping.phone ?? null,
    is_default: true,
    active: true,
  }
}

// Solo las ubicaciones utilizables (activas).
export function activeLocations(locations: DoctorLocation[]): DoctorLocation[] {
  return locations.filter((l) => l.active)
}

// La default UTILIZABLE: activa y marcada default; si no hay marcada, la primera activa; si no
// hay activas, null. (Determinista para el selector de la fase 2.)
export function defaultLocation(locations: DoctorLocation[]): DoctorLocation | null {
  const act = activeLocations(locations)
  return act.find((l) => l.is_default) ?? act[0] ?? null
}

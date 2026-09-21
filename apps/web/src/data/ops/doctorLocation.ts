// Multi-ubicación de entrega (Fase 1) — helpers PUROS (sin red). Adaptan el catálogo
// `doctor_locations` al snapshot de envío del pedido y convierten el domicilio legacy.
// SOLO entrega: nunca tocan datos fiscales (meta.fiscal).
import type { Database } from '../database.types'
import { isAddressUsable, type ShippingAddress } from './shippingAddress'

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

// Resumen legible de una ubicación en una línea (para tarjetas del perfil y selector).
export function summarizeLocation(loc: DoctorLocation): string {
  const num = [loc.exterior_number, loc.interior_number ? `Int. ${loc.interior_number}` : '']
    .map((s) => (s ?? '').trim()).filter(Boolean).join(' ')
  return [[loc.line1, num].filter(Boolean).join(' '), loc.neighborhood, loc.postal_code ? `C.P. ${loc.postal_code}` : '', loc.city, loc.state]
    .map((s) => (s ?? '').trim()).filter(Boolean).join(', ')
}

// PRESELECCIÓN de checkout (Fase 2), determinista y SIN elegir en silencio:
//  - 0 activas          → 'none'            (hay que capturar una dirección)
//  - 1 activa           → 'auto'            (se selecciona sola)
//  - N con default      → 'auto'            (la default)
//  - N sin default      → 'requires-choice' (el doctor DEBE elegir explícitamente)
export type LocationSelectionMode = 'none' | 'auto' | 'requires-choice'
export interface LocationSelection { mode: LocationSelectionMode; selectedId: string | null }

export function initialLocationSelection(locations: DoctorLocation[]): LocationSelection {
  const act = activeLocations(locations)
  if (act.length === 0) return { mode: 'none', selectedId: null }
  if (act.length === 1) return { mode: 'auto', selectedId: act[0].id }
  const def = act.find((l) => l.is_default)
  if (def) return { mode: 'auto', selectedId: def.id }
  return { mode: 'requires-choice', selectedId: null }
}

// ¿Ofrecer la dirección legacy (profiles.meta.shipping) como opción? SOLO si el doctor aún no
// tiene ubicaciones activas y la legacy es usable. Nunca migra sola (evita duplicados por render).
export function shouldOfferLegacy(locations: DoctorLocation[], legacy: ShippingAddress | null | undefined): boolean {
  return activeLocations(locations).length === 0 && isAddressUsable(legacy)
}

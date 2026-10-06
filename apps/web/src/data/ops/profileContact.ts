// CONTACTO guardado en el PERFIL (profiles.meta) — lectura canónica única.
//
// Por qué existe: `register-doctor` guarda el contacto/domicilio del alta bajo
// `profiles.meta.shipping = {line1, colonia, cp, city, state, phone}`, pero varios lectores
// buscaban `meta.phone` / `meta.city` / `meta.address` (formas sueltas antiguas) y por eso
// mostraban "—" y, peor, la aprobación creaba customers sin teléfono ni ciudad.
//
// PRECEDENCIA DETERMINISTA (sin extracción difusa):
//   1) meta.shipping.*      → alta actual (canónico; lo escribe register-doctor)
//   2) meta.commercial.*    → contexto comercial heredado del prospecto (F1, invite-doctor)
//   3) meta.phone/city/address → forma suelta legacy (mock/histórico; la soporta baseAddressOf)
//
// NO es autoridad comercial: el maestro sigue siendo `customers`. Esto solo lee el perfil.
import { baseAddressOf, type ShippingAddress } from './shippingAddress'
import type { Profile } from '../types'

export type ContactOrigin = 'alta' | 'prospecto' | 'legacy'

export interface ResolvedContact<T> {
  value: T | null
  origin: ContactOrigin | null
}

const txt = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

// Primer valor no vacío, conservando de qué forma vino (para etiquetar el origen en la UI).
function firstOf(candidates: [unknown, ContactOrigin][]): ResolvedContact<string> {
  for (const [raw, origin] of candidates) {
    const v = txt(raw)
    if (v !== null) return { value: v, origin }
  }
  return { value: null, origin: null }
}

export interface ProfileContact {
  phone: ResolvedContact<string>
  city: ResolvedContact<string>
  address: ResolvedContact<ShippingAddress>
}

// Contacto legible del perfil. `profile` puede ser null (customer sin portal) → todo vacío.
export function profileContact(profile: Profile | null | undefined): ProfileContact {
  const meta = ((profile?.meta ?? {}) as Record<string, unknown>) ?? {}
  const ship = (meta.shipping ?? {}) as Record<string, unknown>
  const com = (meta.commercial ?? {}) as Record<string, unknown>

  const phone = firstOf([[ship.phone, 'alta'], [com.phone, 'prospecto'], [meta.phone, 'legacy']])
  const city = firstOf([[ship.city, 'alta'], [com.city, 'prospecto'], [meta.city, 'legacy']])

  // Dirección: se reutiliza baseAddressOf (ya resuelve meta.shipping → forma suelta legacy).
  const addr = baseAddressOf(profile ?? null)
  const address: ResolvedContact<ShippingAddress> = addr
    ? { value: addr, origin: meta.shipping ? 'alta' : 'legacy' }
    : { value: null, origin: null }

  return { phone, city, address }
}

// Valor comercial efectivo: el del CUSTOMER manda; el perfil solo rellena huecos.
// Un valor vacío del perfil NUNCA pisa un dato bueno del customer.
export function preferCustomer(customerValue: string | null | undefined, fromProfile: ResolvedContact<string>): ResolvedContact<string> {
  const own = txt(customerValue)
  if (own !== null) return { value: own, origin: null } // origin null = dato propio del customer
  return fromProfile
}

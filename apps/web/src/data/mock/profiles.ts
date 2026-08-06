// Datos de cliente (destino) para envíos. CON BACKEND resuelve del store REAL de
// doctores (perfiles); SIN backend, de la muestra. No inventa un default hardcodeado.
import { hasSupabase } from '../../lib/supabase'
import { getSnapshot as doctorsSnapshot } from '../store/doctorsStore'
import { MOCK_DOCTORS } from './doctores'
import { formatAddress, type ShippingAddress } from '../ops/shippingAddress'

export interface ClientInfo {
  id: string
  name: string
  clinic: string
  phone: string
  address: string
  city: string
}

// Solo para DEMO (sin backend). Con backend nunca se usa este default.
export const DOCTOR_PROFILE: ClientInfo = {
  id: 'doctor-1',
  name: 'Dra. Laura Méndez',
  clinic: 'Clínica Renova Estética',
  phone: '667 123 4567',
  address: 'Av. Álvaro Obregón 1234, Col. Centro',
  city: 'Culiacán, Sin.',
}

const metaOf = (d?: { meta?: unknown }) => (d?.meta ?? {}) as { phone?: string; address?: string; city?: string; shipping?: ShippingAddress }
// Deriva address/city/phone del domicilio BASE estructurado (`meta.shipping`) si existe;
// si no, de los campos sueltos legacy. Así el domicilio capturado en el registro fluye
// al checkout (pre-llenado) y al chofer.
const addrFromMeta = (m: ReturnType<typeof metaOf>): { address: string; city: string; phone: string } => {
  const s = m.shipping
  if (s?.line1) return { address: s.line1, city: [s.colonia, s.cp, s.city, s.state].filter(Boolean).join(', '), phone: s.phone ?? m.phone ?? '' }
  return { address: m.address ?? '', city: m.city ?? '', phone: m.phone ?? '' }
}

// Cliente (destino) por doctor_id. Con Supabase: del perfil REAL (nombre/clínica, y
// tel/dirección de su meta si existen; si no, "—", nunca un dato inventado). En demo:
// de MOCK_DOCTORS. Dirección/teléfono definitivos: capturados en el pedido (fase envío).
export const clientOf = (doctorId: string | null): ClientInfo => {
  if (hasSupabase) {
    const d = doctorId ? doctorsSnapshot().find((x) => x.id === doctorId) : undefined
    const a = addrFromMeta(metaOf(d))
    return {
      id: doctorId ?? '',
      name: d?.full_name ?? 'Doctor',
      clinic: d?.organization ?? '',
      phone: a.phone || '—',
      address: a.address || '—',
      city: a.city || '—',
    }
  }
  // Demo (sin backend).
  if (!doctorId) return DOCTOR_PROFILE
  const d = MOCK_DOCTORS.find((x) => x.id === doctorId)
  if (!d) return DOCTOR_PROFILE
  const a = addrFromMeta(metaOf(d))
  return {
    id: d.id,
    name: d.full_name ?? 'Doctor',
    clinic: d.organization ?? '',
    phone: a.phone || DOCTOR_PROFILE.phone,
    address: a.address || DOCTOR_PROFILE.address,
    city: a.city || DOCTOR_PROFILE.city,
  }
}

// Destino de ENTREGA de un pedido: la dirección que se eligió EN LA VENTA (viaja en
// `order.shipping_meta.address`) tiene prioridad; si el pedido es viejo/sin dirección,
// cae al domicilio del cliente (perfil). El chofer y logística deben usar ESTO, no
// `clientOf` a secas — así una entrega "a otra dirección" llega a donde el cliente pidió.
export function deliveryOf(order: { doctor_id: string | null; shipping_meta?: unknown }): { name: string; addr: string; phone: string } {
  const c = clientOf(order.doctor_id)
  const a = (order.shipping_meta as { address?: ShippingAddress } | null)?.address
  const addr = a?.line1 ? formatAddress(a) : `${c.address}, ${c.city}`
  return { name: c.name, addr, phone: (a?.phone && a.phone.trim()) || c.phone }
}

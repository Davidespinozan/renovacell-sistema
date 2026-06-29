// Datos de cliente (destino) MOCK. Con auth real vendrá de `profiles` (full_name,
// organization) + dirección de envío del pedido. Hoy un único doctor de muestra.
import { MOCK_DOCTORS } from './doctores'

export interface ClientInfo {
  id: string
  name: string
  clinic: string
  phone: string
  address: string
  city: string
}

export const DOCTOR_PROFILE: ClientInfo = {
  id: 'doctor-1',
  name: 'Dra. Laura Méndez',
  clinic: 'Clínica Renova Estética',
  phone: '667 123 4567',
  address: 'Av. Álvaro Obregón 1234, Col. Centro',
  city: 'Culiacán, Sin.',
}

// Cliente (destino) por doctor_id real: nombre/clínica del doctor. La dirección/
// teléfono aún no se modelan por doctor (placeholder); con Supabase vienen del
// perfil + dirección de envío del pedido.
export const clientOf = (doctorId: string | null): ClientInfo => {
  if (!doctorId) return DOCTOR_PROFILE
  const d = MOCK_DOCTORS.find((x) => x.id === doctorId)
  if (!d) return DOCTOR_PROFILE
  return {
    id: d.id,
    name: d.full_name ?? 'Doctor',
    clinic: d.organization ?? '',
    phone: DOCTOR_PROFILE.phone,
    address: DOCTOR_PROFILE.address,
    city: DOCTOR_PROFILE.city,
  }
}

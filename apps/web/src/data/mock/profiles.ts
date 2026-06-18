// Datos de cliente (destino) MOCK. Con auth real vendrá de `profiles` (full_name,
// organization) + dirección de envío del pedido. Hoy un único doctor de muestra.
export interface ClientInfo {
  id: string
  name: string
  clinic: string
  address: string
  city: string
}

export const DOCTOR_PROFILE: ClientInfo = {
  id: 'doctor-1',
  name: 'Dra. Laura Méndez',
  clinic: 'Clínica Renova Estética',
  address: 'Av. Álvaro Obregón 1234, Col. Centro',
  city: 'Culiacán, Sin.',
}

export const clientOf = (_doctorId: string | null): ClientInfo => DOCTOR_PROFILE

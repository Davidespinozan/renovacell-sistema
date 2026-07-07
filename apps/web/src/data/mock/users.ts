// Directorio de usuarios (mock). El chat es comunicación INTERNA: el directorio
// y los DMs son SOLO staff. Los doctores son clientes y NO aparecen aquí para
// chatear (evita fuga de la base de clientes a otros clientes).
// Al conectar Supabase = profiles, ya filtrado por RLS (staffOnly).
import { MOCK_DOCTORS } from './doctores'

export interface DirectoryUser {
  id: string
  name: string
  role: string // etiqueta legible del rol
  isStaff: boolean
  avatarUrl?: string
}

const STAFF: DirectoryUser[] = [
  { id: 'u-claudia', name: 'Claudia Dirección', role: 'Administración', isStaff: true },
  { id: 'u-alberto', name: 'Alberto Almacén', role: 'Almacén / Empaque', isStaff: true },
  { id: 'u-ventas', name: 'Ventas', role: 'Punto de Venta', isStaff: true },
  { id: 'u-chofer', name: 'Chofer local Culiacán', role: 'Chofer', isStaff: true },
]

const DOCTORS: DirectoryUser[] = MOCK_DOCTORS.map((d) => ({
  id: d.id, name: d.full_name ?? 'Doctor', role: 'Doctor', isStaff: false,
}))

// Directorio completo (para otros usos). El chat usa SIEMPRE el scope staffOnly.
export const MOCK_USERS: DirectoryUser[] = [...STAFF, ...DOCTORS].filter((u) => u.id !== 'u-me')

const STAFF_IDS = new Set(STAFF.map((s) => s.id))
export const isStaffUser = (id: string): boolean => STAFF_IDS.has(id)

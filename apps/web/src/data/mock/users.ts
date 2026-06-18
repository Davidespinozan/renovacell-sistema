// Directorio de usuarios dados de alta (mock). Staff + doctores. Es la "base de
// usuarios" con la que se puede abrir un chat. Al conectar Supabase = profiles.
import { MOCK_DOCTORS } from './doctores'

export interface DirectoryUser {
  id: string
  name: string
  role: string // etiqueta legible del rol
}

const STAFF: DirectoryUser[] = [
  { id: 'u-claudia', name: 'Claudia Dirección', role: 'Administración' },
  { id: 'u-alberto', name: 'Alberto Almacén', role: 'Almacén / Empaque' },
  { id: 'u-ventas', name: 'Ventas', role: 'Punto de Venta' },
  { id: 'u-chofer', name: 'Chofer local Culiacán', role: 'Chofer' },
]

export const MOCK_USERS: DirectoryUser[] = [
  ...STAFF,
  ...MOCK_DOCTORS.map((d) => ({ id: d.id, name: d.full_name ?? 'Doctor', role: 'Doctor' })),
].filter((u) => u.id !== 'u-me')

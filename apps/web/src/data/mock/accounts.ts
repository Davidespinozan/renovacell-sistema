// Cuentas demo para el login MOCK. Mapean correo -> rol + verificación.
// Al conectar Supabase Auth, esto lo reemplaza signInWithPassword + perfil.
import type { RoleKey, CapabilityKey } from '../../app/roles'

export interface MockAccount {
  email: string
  password: string
  role: RoleKey
  verified: boolean
  name: string
  capabilities: CapabilityKey[] // responsabilidades extra que asigna Administración
}

// Una cuenta de prueba por rol (password 'demo' en todas). Las capabilities las
// gobierna Admin. Al conectar Supabase, esto será profiles + user_capabilities.
export const MOCK_ACCOUNTS: MockAccount[] = [
  { email: 'direccion@renovacell.mx', password: 'demo', role: 'admin', verified: true, name: 'Claudia · Dirección', capabilities: [] },
  { email: 'almacen@renovacell.mx', password: 'demo', role: 'warehouse', verified: true, name: 'Alberto · Almacén / Empaque', capabilities: ['diseno'] },
  { email: 'pos@renovacell.mx', password: 'demo', role: 'pos', verified: true, name: 'Lucía · Ventas / POS', capabilities: ['comercial'] },
  { email: 'chofer@renovacell.mx', password: 'demo', role: 'driver', verified: true, name: 'Beto · Chofer', capabilities: [] },
  { email: 'laura.mendez@renova.mx', password: 'demo', role: 'doctor', verified: true, name: 'Dra. Laura Méndez', capabilities: [] },
  { email: 'mario.ruiz@dermamr.mx', password: 'demo', role: 'doctor', verified: false, name: 'Dr. Mario Ruiz (en revisión)', capabilities: [] },
]

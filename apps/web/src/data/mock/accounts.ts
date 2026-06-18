// Cuentas demo para el login MOCK. Mapean correo -> rol + verificación.
// Al conectar Supabase Auth, esto lo reemplaza signInWithPassword + perfil.
import type { RoleKey } from '../../app/roles'

export interface MockAccount {
  email: string
  password: string
  role: RoleKey
  verified: boolean
  name: string
}

export const MOCK_ACCOUNTS: MockAccount[] = [
  { email: 'claudia@renovacell.mx', password: 'demo', role: 'admin', verified: true, name: 'Claudia Dirección' },
  { email: 'alberto@renovacell.mx', password: 'demo', role: 'warehouse', verified: true, name: 'Alberto · Almacén / Empaque' },
  { email: 'ventas@renovacell.mx', password: 'demo', role: 'pos', verified: true, name: 'Ventas · POS' },
  { email: 'chofer@renovacell.mx', password: 'demo', role: 'driver', verified: true, name: 'Chofer local' },
  { email: 'laura.mendez@renova.mx', password: 'demo', role: 'doctor', verified: true, name: 'Dra. Laura Méndez (verificada)' },
  { email: 'mario.ruiz@dermamr.mx', password: 'demo', role: 'doctor', verified: false, name: 'Dr. Mario Ruiz (en revisión)' },
]

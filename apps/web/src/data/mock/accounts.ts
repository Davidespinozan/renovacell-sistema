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

// Una cuenta de prueba por rol (password 'demo' en todas). Al conectar Supabase,
// cada correo será un usuario real con su perfil/rol.
export const MOCK_ACCOUNTS: MockAccount[] = [
  { email: 'direccion@renovacell.mx', password: 'demo', role: 'admin', verified: true, name: 'Claudia · Dirección' },
  { email: 'almacen@renovacell.mx', password: 'demo', role: 'warehouse', verified: true, name: 'Alberto · Almacén / Empaque' },
  { email: 'pos@renovacell.mx', password: 'demo', role: 'pos', verified: true, name: 'Caja · Punto de Venta' },
  { email: 'chofer@renovacell.mx', password: 'demo', role: 'driver', verified: true, name: 'Beto · Chofer' },
  { email: 'diseno@renovacell.mx', password: 'demo', role: 'design', verified: true, name: 'Renata · Diseño' },
  { email: 'laura.mendez@renova.mx', password: 'demo', role: 'doctor', verified: true, name: 'Dra. Laura Méndez' },
  { email: 'mario.ruiz@dermamr.mx', password: 'demo', role: 'doctor', verified: false, name: 'Dr. Mario Ruiz (en revisión)' },
]

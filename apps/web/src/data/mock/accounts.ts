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
//
// SEGURIDAD (P0): estas cuentas demo (correos reales del staff + password) son SOLO fixtures
// de desarrollo/test. En producción NO deben viajar en el bundle: `import.meta.env.PROD` es
// true en `vite build`, así que `MOCK_ACCOUNTS` queda vacío y el minificador elimina el
// arreglo `DEMO_ACCOUNTS` por dead-code. En backend real el login usa Supabase Auth (useAuth)
// y el equipo se hidrata de `profiles` (teamStore), así que vacío no rompe nada.
const DEMO_ACCOUNTS: MockAccount[] = [
  { email: 'direccion@renovacell.mx', password: 'demo', role: 'admin', verified: true, name: 'Claudia · Dirección', capabilities: [] },
  { email: 'almacen@renovacell.mx', password: 'demo', role: 'warehouse', verified: true, name: 'Alberto · Almacén / Empaque', capabilities: ['diseno', 'anuncios'] },
  { email: 'ventas1@renovacell.mx', password: 'demo', role: 'pos', verified: true, name: 'Lucía · Ventas', capabilities: ['eventos'] },
  { email: 'ventas2@renovacell.mx', password: 'demo', role: 'pos', verified: true, name: 'Diego · Ventas', capabilities: [] },
  { email: 'chofer@renovacell.mx', password: 'demo', role: 'driver', verified: true, name: 'Beto · Chofer', capabilities: [] },
  { email: 'chofer2@renovacell.mx', password: 'demo', role: 'driver', verified: true, name: 'Marta · Chofer', capabilities: [] },
  { email: 'laura.mendez@renova.mx', password: 'demo', role: 'doctor', verified: true, name: 'Dra. Laura Méndez', capabilities: [] },
  { email: 'mario.ruiz@dermamr.mx', password: 'demo', role: 'doctor', verified: false, name: 'Dr. Mario Ruiz (en revisión)', capabilities: [] },
]

// En producción NO se embarcan cuentas demo (correos/passwords) en el bundle; solo dev/test.
export const MOCK_ACCOUNTS: MockAccount[] = import.meta.env.PROD ? [] : DEMO_ACCOUNTS

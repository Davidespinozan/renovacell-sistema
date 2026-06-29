// Hook de autenticación. HOY mock (mapea correo -> rol/verificación); MAÑANA se
// cambia el cuerpo por Supabase Auth (signInWithPassword + perfil) sin tocar la
// pantalla de Login.
import { useRole } from './RoleContext'
import { MOCK_ACCOUNTS } from '../data/mock/accounts'
import { userByEmail } from '../data/store/teamStore'

export interface LoginResult {
  ok: boolean
  error?: string
}

export function useAuth() {
  const { mode, role, verified, login, logout, setMode } = useRole()

  // Fuente de verdad: staff → teamStore (gobierno de Admin: rol, capabilities,
  // activo); doctores → MOCK_ACCOUNTS (verificación). Así un usuario dado de alta
  // en Equipo SÍ puede entrar y los cambios de Admin se reflejan al loguear.
  const signIn = (email: string, password: string): LoginResult => {
    const e = email.trim()
    const staff = userByEmail(e)
    const acc = MOCK_ACCOUNTS.find((a) => a.email.toLowerCase() === e.toLowerCase())
    if (!staff && !acc) return { ok: false, error: 'Correo no reconocido. Usa una de las cuentas de prueba.' }
    if (password.length === 0) return { ok: false, error: 'Escribe tu contraseña.' }
    if (staff) {
      if (!staff.active) return { ok: false, error: 'Usuario suspendido. Contacta a Administración.' }
      login(staff.role, true, { name: staff.name, email: staff.email }, staff.capabilities)
      return { ok: true }
    }
    // Doctor (de cuentas mock): respeta su estado de verificación.
    login(acc!.role, acc!.verified, { name: acc!.name, email: acc!.email }, acc!.capabilities)
    return { ok: true }
  }

  return {
    mode,
    role,
    verified,
    signIn,
    logout,
    goLogin: () => setMode('login'),
    goLanding: () => setMode('landing'),
  }
}

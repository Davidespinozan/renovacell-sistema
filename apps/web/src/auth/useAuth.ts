// Hook de autenticación. HOY mock (mapea correo -> rol/verificación); MAÑANA se
// cambia el cuerpo por Supabase Auth (signInWithPassword + perfil) sin tocar la
// pantalla de Login.
import { useRole } from './RoleContext'
import { MOCK_ACCOUNTS, type MockAccount } from '../data/mock/accounts'
import { capabilitiesOf, isActive } from '../data/store/teamStore'

export interface LoginResult {
  ok: boolean
  error?: string
}

export function useAuth() {
  const { mode, role, verified, login, logout, setMode } = useRole()

  // Capabilities desde el gobierno de Admin (teamStore); doctores no aplican.
  const enter = (acc: MockAccount) => {
    const caps = acc.role === 'doctor' ? acc.capabilities : capabilitiesOf(acc.email)
    login(acc.role, acc.verified, { name: acc.name, email: acc.email }, caps)
  }

  const signIn = (email: string, password: string): LoginResult => {
    const acc = MOCK_ACCOUNTS.find((a) => a.email.toLowerCase() === email.trim().toLowerCase())
    if (!acc) return { ok: false, error: 'Correo no reconocido. Usa una de las cuentas de prueba.' }
    if (password.length === 0) return { ok: false, error: 'Escribe tu contraseña.' }
    if (acc.role !== 'doctor' && !isActive(acc.email)) return { ok: false, error: 'Usuario suspendido. Contacta a Administración.' }
    enter(acc) // mock: no valida la contraseña real
    return { ok: true }
  }

  return {
    mode,
    role,
    verified,
    signIn,
    signInAs: enter,
    logout,
    goLogin: () => setMode('login'),
    goLanding: () => setMode('landing'),
  }
}

// Hook de autenticación. HOY mock (mapea correo -> rol/verificación); MAÑANA se
// cambia el cuerpo por Supabase Auth (signInWithPassword + perfil) sin tocar la
// pantalla de Login.
import { useRole } from './RoleContext'
import { MOCK_ACCOUNTS } from '../data/mock/accounts'

export interface LoginResult {
  ok: boolean
  error?: string
}

export function useAuth() {
  const { mode, role, verified, login, logout, setMode } = useRole()

  const signIn = (email: string, password: string): LoginResult => {
    const acc = MOCK_ACCOUNTS.find((a) => a.email.toLowerCase() === email.trim().toLowerCase())
    if (!acc) return { ok: false, error: 'Correo no reconocido (usa una cuenta demo).' }
    if (password.length === 0) return { ok: false, error: 'Escribe tu contraseña.' }
    login(acc.role, acc.verified) // mock: no valida la contraseña real
    return { ok: true }
  }

  return {
    mode,
    role,
    verified,
    signIn,
    loginAs: login,
    logout,
    goLogin: () => setMode('login'),
    goLanding: () => setMode('landing'),
  }
}

// Hook de autenticación. Supabase Auth cuando hay backend conectado
// (hasSupabase); si no, cae al login mock (para entornos sin .env). La pantalla
// de Login no cambia salvo esperar la promesa.
import { useRole } from './RoleContext'
import { hasSupabase } from '../lib/supabase'
import { signInSupabase, signOutSupabase, resetPasswordSupabase } from './supabaseAuth'
import { MOCK_ACCOUNTS } from '../data/mock/accounts'
import { userByEmail } from '../data/store/teamStore'
import { verifiedByEmail } from '../data/store/doctorsStore'

export interface LoginResult {
  ok: boolean
  error?: string
}

export function useAuth() {
  const { mode, role, verified, login, logout: roleLogout, setMode } = useRole()

  const signIn = async (email: string, password: string): Promise<LoginResult> => {
    // --- Camino REAL: Supabase Auth + perfil (RLS) ---
    if (hasSupabase) {
      if (password.length === 0) return { ok: false, error: 'Escribe tu contraseña.' }
      const { session, error } = await signInSupabase(email, password)
      if (error || !session) return { ok: false, error: error ?? 'No se pudo iniciar sesión.' }
      login(session.role, session.verified, { name: session.name, email: session.email }, session.capabilities)
      return { ok: true }
    }

    // --- Fallback MOCK (sin backend): staff = teamStore, doctores = MOCK_ACCOUNTS ---
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
    const v = acc!.role === 'doctor' ? (verifiedByEmail(acc!.email) ?? acc!.verified) : acc!.verified
    login(acc!.role, v, { name: acc!.name, email: acc!.email }, acc!.capabilities)
    return { ok: true }
  }

  const logout = async () => {
    if (hasSupabase) await signOutSupabase()
    roleLogout()
  }

  const recoverPassword = async (email: string): Promise<void> => {
    if (hasSupabase) await resetPasswordSupabase(email)
    // sin backend: no-op (la UI muestra el mensaje genérico igual)
  }

  return {
    mode,
    role,
    verified,
    signIn,
    logout,
    recoverPassword,
    goLogin: () => setMode('login'),
    goLanding: () => setMode('landing'),
  }
}

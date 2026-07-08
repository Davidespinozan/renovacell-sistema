// Hook de autenticación. Supabase Auth cuando hay backend conectado
// (hasSupabase); si no, cae al login mock (para entornos sin .env). La pantalla
// de Login no cambia salvo esperar la promesa.
import { useRole } from './RoleContext'
import { hasSupabase, supabase } from '../lib/supabase'
import { signInSupabase, signOutSupabase, resetPasswordSupabase } from './supabaseAuth'
import { MOCK_ACCOUNTS } from '../data/mock/accounts'
import { userByEmail } from '../data/store/teamStore'
import { verifiedByEmail } from '../data/store/doctorsStore'
import { decideVerification, simulateSep } from '../data/verification/decide'

export interface LoginResult {
  ok: boolean
  error?: string
}

export interface RegisterResult {
  decision: 'auto' | 'review' | 'reject' | 'exists'
  reasons?: string[]
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
      login(session.role, session.verified, { name: session.name, email: session.email, avatarUrl: session.avatarUrl }, session.capabilities)
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

  // AUTO-REGISTRO del doctor con verificación SEP instantánea. Si el dictamen es `auto`,
  // crea la cuenta VERIFICADA y entra al portal al momento; si no, deja el motivo.
  const register = async (input: { name: string; email: string; cedula: string; password: string }): Promise<RegisterResult> => {
    const name = input.name.trim(), email = input.email.trim().toLowerCase(), cedula = input.cedula.trim(), password = input.password
    if (name.length < 3) return { decision: 'reject', error: 'Escribe tu nombre completo.' }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { decision: 'reject', error: 'Correo inválido.' }
    if (cedula.replace(/\D/g, '').length < 5) return { decision: 'reject', error: 'Escribe tu número de cédula profesional.' }
    if (password.length < 6) return { decision: 'reject', error: 'La contraseña debe tener al menos 6 caracteres.' }

    if (hasSupabase) {
      const { data, error } = await supabase.functions.invoke('register-doctor', { body: { name, email, cedula, password } })
      if (error) {
        let msg = ''
        try { const b = await (error as { context?: { json?: () => Promise<{ message?: string }> } }).context?.json?.(); msg = b?.message ?? '' } catch { /* noop */ }
        return { decision: 'reject', error: msg || 'No se pudo registrar. Intenta de nuevo.' }
      }
      const decision = (data?.decision ?? 'review') as RegisterResult['decision']
      if (decision === 'auto') {
        const { session } = await signInSupabase(email, password)
        if (session) login(session.role, session.verified, { name: session.name, email: session.email, avatarUrl: session.avatarUrl }, session.capabilities)
        return { decision: 'auto' }
      }
      return { decision, reasons: data?.reasons, error: data?.message }
    }

    // MOCK (sin backend): verifica localmente; si `auto`, entra como doctor verificado.
    const res = decideVerification(name, simulateSep(cedula, name))
    if (res.decision === 'auto') {
      login('doctor', true, { name, email }, [])
      return { decision: 'auto' }
    }
    return { decision: res.decision, reasons: res.reasons }
  }

  return {
    mode,
    role,
    verified,
    signIn,
    register,
    logout,
    recoverPassword,
    goLogin: () => setMode('login'),
    goLanding: () => setMode('landing'),
  }
}

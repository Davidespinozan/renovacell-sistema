// Estado de sesión. Mantiene el usuario logueado, su rol, la pantalla activa y el
// MODO de la app (público=landing, login, app). Hoy el rol/usuario vienen del
// login mock; al conectar Supabase Auth vendrán del perfil y los componentes que
// usan useRole() no cambian.
import React, { useCallback, createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getRole, getEntryScreen, type RoleKey, getNav, resolverDestino } from '../app/roles'
import { pedirPestana } from '../app/Pestanas'
import { FEATURES } from '../app/config'
import { hasSupabase, supabase, currentUserId } from '../lib/supabase'
import { currentSession } from './supabaseAuth'
import { confirmar } from '../data/store/escritura'
import { abrirVisitante, adoptarVisitante } from '../data/ops/visitante'

export type AppMode = 'app' | 'landing' | 'login' | 'reset'

export interface SessionUser { name: string; email: string; avatarUrl?: string }

interface RoleState {
  role: RoleKey
  screen: string
  mode: AppMode
  verified: boolean
  user: SessionUser | null
  capabilities: string[]
  setRole: (r: RoleKey) => void
  setScreen: (s: string) => void
  setMode: (m: AppMode) => void
  login: (role: RoleKey, verified: boolean, profile?: SessionUser, capabilities?: string[]) => void
  actualizarVerificacion: (verified: boolean) => void   // cuenta ≠ verificación: el portal refleja la decisión sin volver a entrar
  logout: () => void
  updateProfile: (patch: Partial<SessionUser> & { fiscal?: Record<string, string> }) => void
}

const RoleCtx = createContext<RoleState | null>(null)

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<RoleKey>('admin')
  const [screen, setScreen] = useState<string>(getEntryScreen(getRole('admin')))
  const [mode, setMode] = useState<AppMode>('login') // puerta de entrada: el login
  const [verified, setVerified] = useState(true)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [capabilities, setCapabilities] = useState<string[]>([])

  // Cambiar de rol manteniendo sesión (no usado por el flujo real; útil interno).
  const setRole = (r: RoleKey) => {
    setRoleState(r)
    setCapabilities([])
    setScreen(getEntryScreen(getRole(r)))
    setVerified(true)
    setMode('app')
  }

  // Login: entra con un rol, su verificación, el perfil y sus capabilities.
  const login = (r: RoleKey, v: boolean, profile?: SessionUser, caps: string[] = []) => {
    setRoleState(r)
    setCapabilities(caps)
    setScreen(getEntryScreen(getRole(r), FEATURES, caps))
    setVerified(v)
    setUser(profile ?? null)
    setMode('app')
  }

  const logout = () => {
    setUser(null)
    setCapabilities([])
    setMode('login')
  }

  // Actualiza el perfil en la sesión Y lo PERSISTE en la base (nombre + foto).
  // La foto ya viene como URL de Storage (la sube MiPerfil). Preserva el resto del
  // meta (capabilities, cédula…) haciendo merge.
  const updateProfile = async (patch: Partial<SessionUser> & { fiscal?: Record<string, string> }) => {
    const antes = user
    setUser((u) => (u ? { ...u, ...patch } : u))
    if (!hasSupabase) return
    const uid = currentUserId()
    if (!uid) return
    const { data } = await supabase.from('profiles').select('meta').eq('id', uid).single()
    const meta = { ...((data?.meta ?? {}) as Record<string, unknown>) }
    if (patch.name != null) meta.name = patch.name
    if (patch.avatarUrl !== undefined) meta.avatar_url = patch.avatarUrl
    if (patch.fiscal) meta.fiscal = { ...((meta.fiscal ?? {}) as Record<string, unknown>), ...patch.fiscal }
    const fields: Record<string, unknown> = { meta }
    if (patch.name != null) fields.full_name = patch.name
    // W4: antes el resultado se descartaba — el perfil (y sus datos fiscales) podía NO
    // guardarse y la pantalla seguir mostrándolo como guardado. Si el servidor lo
    // rechaza, se avisa y la sesión vuelve a lo que realmente está en la base.
    const r = await confirmar('guardar tu perfil', supabase.from('profiles').update(fields as never).eq('id', uid))
    if (!r.ok) { setUser(antes); return }
    // Refresca el directorio para que tu nueva foto/nombre se vea en chat/anuncios.
    const { reload } = await import('../data/store/directoryStore')
    reload()
  }

  // Con backend conectado: rehidrata la sesión al recargar (mantiene al usuario
  // dentro si ya había iniciado sesión) y reacciona al cierre de sesión.
  useEffect(() => {
    if (!hasSupabase) return
    let active = true
    // #2: si llegan por el enlace de recuperación, NO auto-loguear: llevar a fijar
    // nueva contraseña.
    const recovery = typeof window !== 'undefined' && /type=recovery/.test(window.location.hash)
    if (recovery) {
      setMode('reset')
    } else {
      currentSession().then((s) => {
        if (active && s) login(s.role, s.verified, { name: s.name, email: s.email, avatarUrl: s.avatarUrl }, s.capabilities)
        // CC-1 · identidad de visitante (silenciosa): sin sesión se abre/reanuda; con sesión
        // la cuenta adopta lo que hizo antes de existir (token poseído o vínculo del registro).
        if (active) void (s ? adoptarVisitante() : abrirVisitante())
      })
    }
    // PERF: SIGNED_IN también llega al volver a la pestaña; adoptar solo cuando cambia la cuenta.
    let uidAdoptado = currentUserId()
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null
      if (event === 'PASSWORD_RECOVERY') setMode('reset')
      else if (event === 'SIGNED_IN') { if (uid !== uidAdoptado) { uidAdoptado = uid; void adoptarVisitante() } }
      else if (event === 'SIGNED_OUT') {
        setUser(null)
        setCapabilities([])
        setMode('login')
      } else if (event === 'TOKEN_REFRESHED') {
        // W6-A1: cada renovación vuelve a leer el perfil; una cuenta suspendida cierra sesión.
        void currentSession()
      }
    })
    return () => { active = false; sub.subscription.unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // MENÚ AGRUPADO: una clave que vive dentro de un grupo (o que ya no tiene entrada) se traduce a su pantalla real;
  // la pestaña pedida la toma el grupo al montarse. Así los avisos, tareas y enlaces profundos siguen funcionando.
  const irA = useCallback((s: string) => {
    const d = resolverDestino(getNav(getRole(role), FEATURES, capabilities), s)
    if (d.pestana) pedirPestana(d.screen, d.pestana)
    setScreen(d.screen)
  }, [role, capabilities])
  const value = useMemo(
    () => ({ role, screen, mode, verified, user, capabilities, setRole, setScreen: irA, setMode, login, logout, updateProfile, actualizarVerificacion: setVerified }),
    [role, screen, mode, verified, user, capabilities, irA],
  )
  return <RoleCtx.Provider value={value}>{children}</RoleCtx.Provider>
}

export function useRole(): RoleState {
  const ctx = useContext(RoleCtx)
  if (!ctx) throw new Error('useRole debe usarse dentro de <RoleProvider>')
  return ctx
}
/** Variante tolerante: null fuera de <RoleProvider> (componentes de presentación que solo
    necesitan saber en qué pantalla están, p. ej. PageHead). */
export function useRoleOpcional(): RoleState | null {
  return useContext(RoleCtx)
}

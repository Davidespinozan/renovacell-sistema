// Estado de sesión. Mantiene el usuario logueado, su rol, la pantalla activa y el
// MODO de la app (público=landing, login, app). Hoy el rol/usuario vienen del
// login mock; al conectar Supabase Auth vendrán del perfil y los componentes que
// usan useRole() no cambian.
import React, { createContext, useContext, useMemo, useState } from 'react'
import { getRole, getEntryScreen, type RoleKey } from '../app/roles'
import { FEATURES } from '../app/config'

export type AppMode = 'app' | 'landing' | 'login'

export interface SessionUser { name: string; email: string }

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
  logout: () => void
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

  const value = useMemo(
    () => ({ role, screen, mode, verified, user, capabilities, setRole, setScreen, setMode, login, logout }),
    [role, screen, mode, verified, user, capabilities],
  )
  return <RoleCtx.Provider value={value}>{children}</RoleCtx.Provider>
}

export function useRole(): RoleState {
  const ctx = useContext(RoleCtx)
  if (!ctx) throw new Error('useRole debe usarse dentro de <RoleProvider>')
  return ctx
}

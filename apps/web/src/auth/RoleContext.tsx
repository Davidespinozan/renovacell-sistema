// Estado de sesión/preview (dev). Mantiene el rol activo (como el 'ver como'),
// la pantalla activa y el MODO de la app: público (landing), login o app.
// Cuando conectemos Supabase Auth, el rol/verified vendrán del perfil; los
// componentes que usan useRole() no cambian.
import React, { createContext, useContext, useMemo, useState } from 'react'
import { getRole, getEntryScreen, type RoleKey } from '../app/roles'

export type AppMode = 'app' | 'landing' | 'login'

interface RoleState {
  role: RoleKey
  screen: string
  mode: AppMode
  verified: boolean
  setRole: (r: RoleKey) => void
  setScreen: (s: string) => void
  setMode: (m: AppMode) => void
  login: (role: RoleKey, verified: boolean) => void
  logout: () => void
}

const RoleCtx = createContext<RoleState | null>(null)

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<RoleKey>('admin')
  const [screen, setScreen] = useState<string>(getEntryScreen(getRole('admin')))
  const [mode, setMode] = useState<AppMode>('app')
  const [verified, setVerified] = useState(true)

  // "Ver como" un rol (dev): aterriza en su entrada, modo app. Asume verificado.
  const setRole = (r: RoleKey) => {
    setRoleState(r)
    setScreen(getEntryScreen(getRole(r)))
    setVerified(true)
    setMode('app')
  }

  // Login (mock): entra con un rol y su estado de verificación.
  const login = (r: RoleKey, v: boolean) => {
    setRoleState(r)
    setScreen(getEntryScreen(getRole(r)))
    setVerified(v)
    setMode('app')
  }

  const logout = () => setMode('login')

  const value = useMemo(
    () => ({ role, screen, mode, verified, setRole, setScreen, setMode, login, logout }),
    [role, screen, mode, verified],
  )
  return <RoleCtx.Provider value={value}>{children}</RoleCtx.Provider>
}

export function useRole(): RoleState {
  const ctx = useContext(RoleCtx)
  if (!ctx) throw new Error('useRole debe usarse dentro de <RoleProvider>')
  return ctx
}

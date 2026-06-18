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
  setRole: (r: RoleKey) => void
  setScreen: (s: string) => void
  setMode: (m: AppMode) => void
}

const RoleCtx = createContext<RoleState | null>(null)

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<RoleKey>('admin')
  const [screen, setScreen] = useState<string>(getEntryScreen(getRole('admin')))
  const [mode, setMode] = useState<AppMode>('app')

  // "Ver como" un rol: aterriza en su pantalla de entrada y vuelve al modo app.
  const setRole = (r: RoleKey) => {
    setRoleState(r)
    setScreen(getEntryScreen(getRole(r)))
    setMode('app')
  }

  const value = useMemo(() => ({ role, screen, mode, setRole, setScreen, setMode }), [role, screen, mode])
  return <RoleCtx.Provider value={value}>{children}</RoleCtx.Provider>
}

export function useRole(): RoleState {
  const ctx = useContext(RoleCtx)
  if (!ctx) throw new Error('useRole debe usarse dentro de <RoleProvider>')
  return ctx
}

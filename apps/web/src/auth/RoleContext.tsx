// AUTH STUB (solo dev). No hay login real todavía.
// Mantiene el "rol activo" (como el 'ver como' del demo) y la pantalla activa.
// La entrada por rol respeta los add-ons contratados (config.ts):
//   staff -> vista común si "comunicación interna" está activa, si no su primer módulo;
//   doctor -> su portal.
// Cuando conectemos Supabase Auth, este provider leerá el rol del perfil; los
// componentes que usan useRole() no cambian.
import React, { createContext, useContext, useMemo, useState } from 'react'
import { getRole, getEntryScreen, type RoleKey } from '../app/roles'

interface RoleState {
  role: RoleKey
  screen: string
  setRole: (r: RoleKey) => void
  setScreen: (s: string) => void
}

const RoleCtx = createContext<RoleState | null>(null)

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<RoleKey>('admin')
  const [screen, setScreen] = useState<string>(getEntryScreen(getRole('admin')))

  const setRole = (r: RoleKey) => {
    setRoleState(r)
    setScreen(getEntryScreen(getRole(r)))
  }

  const value = useMemo(() => ({ role, screen, setRole, setScreen }), [role, screen])
  return <RoleCtx.Provider value={value}>{children}</RoleCtx.Provider>
}

export function useRole(): RoleState {
  const ctx = useContext(RoleCtx)
  if (!ctx) throw new Error('useRole debe usarse dentro de <RoleProvider>')
  return ctx
}

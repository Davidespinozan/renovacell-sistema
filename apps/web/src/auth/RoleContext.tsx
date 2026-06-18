// AUTH STUB (solo dev). No hay login real todavía.
// Mantiene el "rol activo" (como el 'ver como' del demo) y la pantalla activa.
// Cuando conectemos Supabase Auth, este provider se reemplaza por uno que lea
// el rol del perfil; los componentes que usan useRole() no cambian.
import React, { createContext, useContext, useMemo, useState } from 'react'
import { ROLES, getRole, type RoleKey } from '../app/roles'

interface RoleState {
  role: RoleKey
  screen: string
  setRole: (r: RoleKey) => void
  setScreen: (s: string) => void
}

const RoleCtx = createContext<RoleState | null>(null)

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<RoleKey>('admin')
  // Entrada tras "login": staff -> vista común; doctor -> su portal.
  const [screen, setScreen] = useState<string>(getRole('admin').entry)

  // Al cambiar de rol, aterrizar en la pantalla de entrada de ese rol.
  const setRole = (r: RoleKey) => {
    setRoleState(r)
    setScreen(getRole(r).entry)
  }

  const value = useMemo(() => ({ role, screen, setRole, setScreen }), [role, screen])
  return <RoleCtx.Provider value={value}>{children}</RoleCtx.Provider>
}

export function useRole(): RoleState {
  const ctx = useContext(RoleCtx)
  if (!ctx) throw new Error('useRole debe usarse dentro de <RoleProvider>')
  return ctx
}

export { ROLES }

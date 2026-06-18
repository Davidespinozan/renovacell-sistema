// Registro de pantallas: mapea pantalla -> componente.
// La vista común ('comun') es el home del hub. El resto son módulos por rol
// (hoy Placeholder; se reemplazan al construir cada pantalla real).
import React from 'react'
import { Placeholder } from './Placeholder'
import { CommonView } from './CommonView'
import { COMMON_SCREEN, type RoleKey } from '../app/roles'

const SCREENS: Record<string, () => React.ReactNode> = {
  [COMMON_SCREEN.key]: () => <CommonView />,
  // Cuando una pantalla esté lista: SCREENS['tablero'] = () => <AdminTablero/>
}

export function renderScreen(role: RoleKey, screen: string): React.ReactNode {
  const real = SCREENS[screen]
  if (real) return real()
  return <Placeholder role={role} screen={screen} />
}

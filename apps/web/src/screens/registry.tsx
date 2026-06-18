// Registro de pantallas: mapea (rol, pantalla) -> componente.
// HOY todo apunta a <Placeholder>. Conforme construyamos pantallas reales,
// se registran aquí por su `key` (p. ej. 'tablero' -> <AdminTablero/>).
import React from 'react'
import { Placeholder } from './Placeholder'
import type { RoleKey } from '../app/roles'

// Cuando una pantalla esté lista: SCREENS['tablero'] = () => <AdminTablero/>
const SCREENS: Record<string, () => React.ReactNode> = {}

export function renderScreen(role: RoleKey, screen: string): React.ReactNode {
  const real = SCREENS[screen]
  if (real) return real()
  return <Placeholder role={role} screen={screen} />
}

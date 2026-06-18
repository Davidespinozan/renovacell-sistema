// Bottom nav móvil (solo <900px, vía CSS). Navegación rápida por rol: muestra
// los primeros destinos del rol activo (la lista completa sigue en el drawer).
import React from 'react'
import { Icon } from './icons'
import { getRole, getNav, COMMON_SCREEN } from './roles'
import { useRole } from '../auth/RoleContext'

// Etiqueta corta para el bottom nav.
function short(label: string, key: string): string {
  if (key === COMMON_SCREEN.key) return 'Inicio'
  return label.replace(/^Mis\s+/i, '').replace(/^Por\s+/i, '').split(' (')[0]
}

export function BottomNav() {
  const { role, screen, setScreen } = useRole()
  const items = getNav(getRole(role)).slice(0, 5)

  return (
    <nav className="bnav">
      {items.map((s) => (
        <a key={s.key} className={s.key === screen ? 'on' : undefined} onClick={() => setScreen(s.key)}>
          <Icon name={s.icon} />
          <span>{short(s.label, s.key)}</span>
        </a>
      ))}
    </nav>
  )
}

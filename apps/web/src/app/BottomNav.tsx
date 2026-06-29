// Bottom nav móvil (<900px, vía CSS). Abajo van los accesos COMUNES (Inicio/Chat
// del hub); el resto de módulos del rol se abren con "Menú" (cajón con el rol
// visible). Sin hub (p. ej. doctor) muestra sus propios módulos.
import React from 'react'
import { Icon } from './icons'
import { getRole, getNav, HUB_SCREENS, COMMON_SCREEN } from './roles'
import { useRole } from '../auth/RoleContext'

const HUB_KEYS = new Set(HUB_SCREENS.map((s) => s.key))

function short(label: string, key: string): string {
  if (key === COMMON_SCREEN.key) return 'Inicio'
  return label.replace(/^Mis\s+/i, '').replace(/^Por\s+/i, '').split(' (')[0]
}

export function BottomNav({ onMenu }: { onMenu: () => void }) {
  const { role, screen, setScreen, capabilities } = useRole()
  const nav = getNav(getRole(role), undefined, capabilities)
  const hub = nav.filter((s) => HUB_KEYS.has(s.key))
  const modules = nav.filter((s) => !HUB_KEYS.has(s.key))

  const primary = hub.length > 0 ? hub : modules.slice(0, 4)
  const showMenu = hub.length > 0 || modules.length > 4

  return (
    <nav className="bnav">
      {primary.map((s) => (
        <a key={s.key} className={s.key === screen ? 'on' : undefined} onClick={() => setScreen(s.key)}>
          <Icon name={s.icon} />
          <span>{short(s.label, s.key)}</span>
        </a>
      ))}
      {showMenu && (
        <a onClick={onMenu}>
          <Icon name="menu" />
          <span>Menú</span>
        </a>
      )}
    </nav>
  )
}

// Bottom nav móvil (<900px, vía CSS). Staff: Inicio + Avisos/Chat del equipo (hub); el resto de
// módulos se abren con "Menú". Doctor: Inicio + sus primeros módulos. El Menú siempre está.
import React from 'react'
import { Icon } from './icons'
import { getRole, getNav, HUB_KEYS, INICIO_SCREEN, COMMON_SCREEN, CHAT_SCREEN } from './roles'
import { useRole } from '../auth/RoleContext'

function short(label: string, key: string): string {
  if (key === INICIO_SCREEN.key) return 'Inicio'
  if (key === COMMON_SCREEN.key) return 'Avisos'
  if (key === CHAT_SCREEN.key) return 'Chat'
  return label.replace(/^Mis\s+/i, '').replace(/^Por\s+/i, '').split(' (')[0]
}

export function BottomNav({ onMenu }: { onMenu: () => void }) {
  const { role, screen, setScreen, capabilities } = useRole()
  const r = getRole(role)
  const nav = getNav(r, undefined, capabilities)
  const hub = nav.filter((s) => HUB_KEYS.has(s.key))

  // El cajón (Sidebar) tiene perfil, ajustes y CERRAR SESIÓN → debe estar SIEMPRE accesible en
  // móvil (antes el doctor, con hub vacío y 4 módulos exactos, se quedaba sin "Menú" y no podía
  // salir). Con el Menú siempre visible, dejamos 3 accesos directos + Menú (4 pestañas máx).
  const showMenu = true
  const primary = r.isStaff && hub.length > 1 ? hub.slice(0, 3) : nav.slice(0, 3)

  // R-36/R-24: enlaces sin href → foco por teclado (role=button, tabIndex) + Enter/Espacio.
  const onKey = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() } }
  return (
    <nav className="bnav">
      {primary.map((s) => (
        <a key={s.key} role="button" tabIndex={0} aria-current={s.key === screen ? 'page' : undefined}
          className={s.key === screen ? 'on' : undefined}
          onClick={() => setScreen(s.key)} onKeyDown={onKey(() => setScreen(s.key))}>
          <Icon name={s.icon} />
          <span>{short(s.label, s.key)}</span>
        </a>
      ))}
      {showMenu && (
        <a role="button" tabIndex={0} onClick={onMenu} onKeyDown={onKey(onMenu)}>
          <Icon name="menu" />
          <span>Menú</span>
        </a>
      )}
    </nav>
  )
}

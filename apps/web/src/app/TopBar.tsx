// Barra superior: hamburguesa (móvil), título/subtítulo de la pantalla, buscador y campana.
import React from 'react'
import { Icon } from './icons'
import { getRole, getScreen } from './roles'
import { useRole } from '../auth/RoleContext'

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { role, screen } = useRole()
  const r = getRole(role)
  const s = getScreen(r, screen)

  return (
    <header className="top">
      <button className="hamb" aria-label="Abrir menú" type="button" onClick={onMenu}>
        <Icon name="menu" />
      </button>
      <div>
        <h1 className="screen-title serif">{s.label}</h1>
        <div className="screen-sub">{r.label}</div>
      </div>
      <div className="top-r">
        <div className="searchbox">
          <Icon name="search" />
          <input placeholder="Buscar…" />
        </div>
        <button className="icobtn" type="button" aria-label="Notificaciones">
          <Icon name="bell" />
          <span className="bdg" />
        </button>
      </div>
    </header>
  )
}

// Sidebar: marca + navegación de la pantalla por rol + pie "Operado por STRYV".
import React from 'react'
import { Icon } from './icons'
import { getRole } from './roles'
import { useRole } from '../auth/RoleContext'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { role, screen, setScreen } = useRole()
  const r = getRole(role)

  return (
    <aside className="side">
      <div className="brand">
        <span className="lw">
          <Icon name="leaf" style={{ width: 40, height: 40, color: 'var(--green-soft)' }} />
        </span>
        <div>
          <div className="bn">Renovacell</div>
          <div className="bs">Sistema operativo</div>
        </div>
      </div>

      <nav className="nav">
        <div className="grp">{r.group}</div>
        {r.screens.map((s) => (
          <a
            key={s.key}
            className={s.key === screen ? 'on' : undefined}
            onClick={() => {
              setScreen(s.key)
              onNavigate?.()
            }}
          >
            <Icon name={s.icon} />
            <span>{s.label}</span>
          </a>
        ))}
      </nav>

      <div className="side-foot">
        <div className="op">
          <span className="live" /> Operado por <b>STRYV</b>
        </div>
      </div>
    </aside>
  )
}

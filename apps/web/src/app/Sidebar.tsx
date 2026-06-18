// Sidebar del hub: marca + navegación (vista común si el add-on está activo +
// módulos del rol) + pie "Operado por STRYV". El marco permanece; el contenido cambia.
import React from 'react'
import { Icon } from './icons'
import { getRole, getNav, HUB_SCREENS } from './roles'
import { useRole } from '../auth/RoleContext'

const HUB_KEYS = new Set(HUB_SCREENS.map((s) => s.key))

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { role, screen, setScreen } = useRole()
  const r = getRole(role)
  const nav = getNav(r)
  const hub = nav.filter((s) => HUB_KEYS.has(s.key))
  const modules = nav.filter((s) => !HUB_KEYS.has(s.key))

  const go = (key: string) => {
    setScreen(key)
    onNavigate?.()
  }

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
        {/* Hub (vista común + chat): solo con el add-on de Comunicación interna. */}
        {hub.length > 0 && (
          <>
            <div className="grp">Hub Renovacell</div>
            {hub.map((s) => (
              <a key={s.key} className={s.key === screen ? 'on' : undefined} onClick={() => go(s.key)}>
                <Icon name={s.icon} />
                <span>{s.label}</span>
              </a>
            ))}
          </>
        )}

        {modules.length > 0 && (
          <>
            <div className="grp">{r.group}</div>
            {modules.map((s) => (
              <a key={s.key} className={s.key === screen ? 'on' : undefined} onClick={() => go(s.key)}>
                <Icon name={s.icon} />
                <span>{s.label}</span>
              </a>
            ))}
          </>
        )}
      </nav>

      <div className="side-foot">
        <div className="op">
          <span className="live" /> Operado por <b>STRYV</b>
        </div>
      </div>
    </aside>
  )
}

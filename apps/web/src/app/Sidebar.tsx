// Sidebar del hub: marca + navegación (vista común para staff + módulos del rol)
// + pie "Operado por STRYV". El marco permanece; el contenido cambia al módulo.
import React from 'react'
import { Icon } from './icons'
import { getRole, COMMON_SCREEN } from './roles'
import { useRole } from '../auth/RoleContext'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { role, screen, setScreen } = useRole()
  const r = getRole(role)

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
        {/* Vista común: solo staff (el doctor no la ve). */}
        {r.isStaff && (
          <>
            <div className="grp">Hub Renovacell</div>
            <a
              className={screen === COMMON_SCREEN.key ? 'on' : undefined}
              onClick={() => go(COMMON_SCREEN.key)}
            >
              <Icon name={COMMON_SCREEN.icon} />
              <span>{COMMON_SCREEN.label}</span>
            </a>
          </>
        )}

        {/* Módulos del rol */}
        {r.modules.length > 0 && (
          <>
            <div className="grp">{r.group}</div>
            {r.modules.map((s) => (
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

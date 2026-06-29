// Sidebar del hub: marca + indicador de rol + navegación agrupada por secciones
// (evita el "muro" de links) + usuario y cierre de sesión. El marco permanece; el
// contenido cambia.
import React from 'react'
import { LogOut } from 'lucide-react'
import { Icon } from './icons'
import { getRole, getNav, HUB_SCREENS, type ScreenDef } from './roles'
import { useRole } from '../auth/RoleContext'
import { initials } from '../lib/format'

const HUB_KEYS = new Set(HUB_SCREENS.map((s) => s.key))

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { role, screen, setScreen, user, logout } = useRole()
  const r = getRole(role)
  const nav = getNav(r)
  const hub = nav.filter((s) => HUB_KEYS.has(s.key))
  const modules = nav.filter((s) => !HUB_KEYS.has(s.key))

  // Agrupa módulos por sección (consecutivos). Sin sección → grupo del rol.
  const groups: { header: string; items: ScreenDef[] }[] = []
  modules.forEach((m) => {
    const header = m.section ?? r.group
    const last = groups[groups.length - 1]
    if (last && last.header === header) last.items.push(m)
    else groups.push({ header, items: [m] })
  })

  const go = (key: string) => { setScreen(key); onNavigate?.() }

  const Link = (s: ScreenDef) => (
    <a key={s.key} className={s.key === screen ? 'on' : undefined} onClick={() => go(s.key)}>
      <Icon name={s.icon} />
      <span>{s.label}</span>
    </a>
  )

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

      {/* Rol activo: deja claro en qué puerta está parado el usuario. */}
      <div className="side-role"><Icon name={r.icon} /> {r.label}</div>

      <nav className="nav">
        {hub.length > 0 && (
          <>
            <div className="grp">Hub Renovacell</div>
            {hub.map(Link)}
          </>
        )}
        {groups.map((g) => (
          <React.Fragment key={g.header}>
            <div className="grp">{g.header}</div>
            {g.items.map(Link)}
          </React.Fragment>
        ))}
      </nav>

      <div className="side-foot">
        {user && (
          <div className="side-user">
            <div className="su-av">{initials(user.name)}</div>
            <div className="su-meta">
              <div className="su-name">{user.name}</div>
              <div className="su-role">{r.label}</div>
            </div>
            <button className="su-out" type="button" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={logout}>
              <LogOut size={16} />
            </button>
          </div>
        )}
        <div className="op">
          <span className="live" /> Operado por <b>STRYV</b>
        </div>
      </div>
    </aside>
  )
}

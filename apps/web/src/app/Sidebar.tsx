// Sidebar del hub: marca + indicador de rol + navegación agrupada por secciones
// (evita el "muro" de links) + usuario y cierre de sesión. El marco permanece; el
// contenido cambia.
import React, { useState } from 'react'
import { LogOut, Pencil, Settings } from 'lucide-react'
import { Icon } from './icons'
import { getRole, getNav, HUB_SCREENS, type ScreenDef } from './roles'
import { useRole } from '../auth/RoleContext'
import { initials } from '../lib/format'
import { ProfileModal } from '../screens/MiPerfil'
import { Ajustes } from '../screens/Ajustes'
import { BrandLogo } from './BrandLogo'

const HUB_KEYS = new Set(HUB_SCREENS.map((s) => s.key))

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { role, screen, setScreen, user, logout, capabilities } = useRole()
  const [profileOpen, setProfileOpen] = useState(false)
  const [ajustesOpen, setAjustesOpen] = useState(false)
  const r = getRole(role)
  const nav = getNav(r, undefined, capabilities)
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
          <BrandLogo />
        </span>
        <div>
          <div className="bn">Renovacell</div>
          <div className="bs">Sistema operativo</div>
        </div>
      </div>

      {/* Rol activo: deja claro en qué puerta está parado el usuario. */}
      <div className="side-role"><Icon name={r.icon} /> {r.label}</div>

      <nav className="nav">
        {/* En móvil el hub (Inicio/Chat) ya vive en el bottom-nav → se oculta aquí. */}
        {hub.length > 0 && (
          <div className="nav-hub">
            <div className="grp">Hub Renovacell</div>
            {hub.map(Link)}
          </div>
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
            <button type="button" className="su-open" title="Editar mi perfil" onClick={() => setProfileOpen(true)}>
              {user.avatarUrl
                ? <img className="su-av" src={user.avatarUrl} alt="" />
                : <span className="su-av">{initials(user.name)}</span>}
              <span className="su-meta">
                <span className="su-name">{user.name.split('·')[0].trim()}</span>
                <span className="su-role">Editar perfil</span>
              </span>
              <Pencil size={14} className="su-edit" />
            </button>
            <button className="side-logout" type="button" onClick={() => setAjustesOpen(true)}>
              <Settings size={15} /> Ajustes
            </button>
            <button className="side-logout" type="button" onClick={logout}>
              <LogOut size={15} /> Cerrar sesión
            </button>
          </div>
        )}
        <div className="op">
          <span className="live" /> Operado por <b>STRYV</b>
        </div>
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      {ajustesOpen && <Ajustes onClose={() => setAjustesOpen(false)} />}
    </aside>
  )
}

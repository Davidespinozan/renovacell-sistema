// Sidebar del hub: marca + indicador de rol + navegación agrupada por secciones
// (evita el "muro" de links) + usuario y cierre de sesión. El marco permanece; el
// contenido cambia.
import React, { useEffect, useState } from 'react'
import { ChevronRight, LogOut, Pencil, Settings } from 'lucide-react'
import { Icon } from './icons'
import { getRole, getNav, HUB_KEYS, type ScreenDef } from './roles'
import { useRole } from '../auth/RoleContext'
import { initials } from '../lib/format'
import { ProfileModal } from '../screens/MiPerfil'
import { Ajustes } from '../screens/Ajustes'
import { BrandLogo } from './BrandLogo'

// SECCIONES PLEGABLES (como en CuboPolar): se pica el encabezado y se abre o se cierra; la preferencia se recuerda en
// este navegador. La sección de la pantalla activa se abre sola. Sin preferencia guardada, Dirección arranca con lo de
// uso diario abierto (Mi trabajo, Clientes, Conversaciones) y el resto plegado; los demás roles ven todo abierto.
const CLAVE_SECCIONES = 'rc_sidebar_secciones'
const ABIERTAS_POR_DEFECTO = new Set(['Mi trabajo', 'Clientes', 'Conversaciones'])
const leerSecciones = (): Record<string, boolean> | null => { try { const v = localStorage.getItem(CLAVE_SECCIONES); return v ? JSON.parse(v) as Record<string, boolean> : null } catch { return null } }
const guardarSecciones = (m: Record<string, boolean>) => { try { localStorage.setItem(CLAVE_SECCIONES, JSON.stringify(m)) } catch { /* almacenamiento no disponible: no pasa nada */ } }

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

  // Secciones abiertas: preferencia guardada → defecto por rol. La de la pantalla activa siempre se muestra.
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>(() => leerSecciones() ?? (role === 'admin' ? Object.fromEntries(groups.map((g) => [g.header, ABIERTAS_POR_DEFECTO.has(g.header)])) : {}))
  const seccionActiva = modules.find((m) => m.key === screen)?.section ?? null
  useEffect(() => { if (seccionActiva && abiertas[seccionActiva] === false) setAbiertas((a) => ({ ...a, [seccionActiva]: true })) }, [seccionActiva])   // eslint-disable-line react-hooks/exhaustive-deps
  const estaAbierta = (h: string) => abiertas[h] !== false
  const alternar = (h: string) => setAbiertas((a) => { const n = { ...a, [h]: !estaAbierta(h) }; guardarSecciones(n); return n })

  const go = (key: string) => { setScreen(key); onNavigate?.() }

  const Link = (s: ScreenDef) => (
    // R-36/R-24: enlaces sin href → damos foco por teclado (role=button, tabIndex) y activación
    // con Enter/Espacio; antes no recibían foco ni respondían al teclado.
    <a
      key={s.key} role="button" tabIndex={0} aria-current={s.key === screen ? 'page' : undefined}
      className={s.key === screen ? 'on' : undefined}
      onClick={() => go(s.key)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(s.key) } }}
    >
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
          <div className="bs">{role === 'doctor' ? 'Tecnologías Antiedad' : 'Sistema operativo'}</div>
        </div>
      </div>

      {/* Rol activo: deja claro en qué puerta está parado el usuario. */}
      <div className="side-role"><Icon name={r.icon} /> {r.label}</div>

      <nav className="nav">
        {/* Inicio + Avisos/Chat del equipo. En móvil el hub del staff vive en el bottom-nav → se oculta aquí. */}
        {hub.length > 0 && (
          <div className="nav-hub">
            <div className="grp">Hub Renovacell</div>
            {hub.map(Link)}
          </div>
        )}
        {groups.map((g) => (
          <React.Fragment key={g.header}>
            <button type="button" className={`grp grp-btn${estaAbierta(g.header) ? ' abierta' : ''}`} aria-expanded={estaAbierta(g.header)} onClick={() => alternar(g.header)} data-testid={`seccion-${g.header}`}>
              <span>{g.header}</span><ChevronRight size={13} aria-hidden="true" />
            </button>
            {estaAbierta(g.header) && g.items.map(Link)}
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
            <button className="side-logout" type="button" onClick={() => { if (window.confirm('¿Cerrar sesión? Se perderá lo que no hayas guardado (por ejemplo, el carrito).')) logout() }}>
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

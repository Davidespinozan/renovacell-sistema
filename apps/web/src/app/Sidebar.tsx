// Sidebar del hub: marca + indicador de rol + navegación agrupada por secciones
// (evita el "muro" de links) + usuario y cierre de sesión. El marco permanece; el
// contenido cambia.
import React, { useEffect, useState } from 'react'
import { ChevronRight, LogOut, Settings } from 'lucide-react'
import { Icon } from './icons'
import { getRole, getNav, HUB_KEYS, STRYV_CARE_SCREEN, type ScreenDef } from './roles'
import { useRole } from '../auth/RoleContext'
import { initials } from '../lib/format'
import { ProfileModal } from '../screens/MiPerfil'
import { Ajustes } from '../screens/Ajustes'
import { BrandLogo } from './BrandLogo'

// SECCIONES PLEGABLES (como en CuboPolar): se pica el encabezado y se abre o se cierra; la preferencia se recuerda en
// este navegador. La sección de la pantalla activa se abre sola. Sin preferencia guardada, Dirección arranca con lo de
// uso diario abierto (Mi trabajo, Clientes, Conversaciones) y el resto plegado; los demás roles ven todo abierto.
const CLAVE_SECCIONES = 'rc_sidebar_secciones'
const HUB = 'Hub Renovacell'
const ABIERTAS_POR_DEFECTO = new Set([HUB, 'Mi trabajo', 'Clientes', 'Conversaciones'])
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

  // Agrupa módulos por sección (en el orden en que aparece cada sección). Sin sección → grupo del rol.
  // Una capacidad puede sumar módulos a una sección del rol ya listada (p. ej. Conversaciones en "Mi cartera"
  // después de Eventos): se unen al mismo grupo en vez de repetir el encabezado.
  const groups: { header: string; items: ScreenDef[] }[] = []
  modules.forEach((m) => {
    const header = m.section ?? r.group
    const grupo = groups.find((g) => g.header === header)
    if (grupo) grupo.items.push(m)
    else groups.push({ header, items: [m] })
  })

  // Secciones abiertas: preferencia guardada → defecto por rol. La de la pantalla activa siempre se muestra.
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>(() => leerSecciones() ?? (role === 'admin' ? Object.fromEntries([HUB, ...groups.map((g) => g.header)].map((h) => [h, ABIERTAS_POR_DEFECTO.has(h)])) : {}))
  const seccionActiva = hub.some((m) => m.key === screen) ? HUB : (modules.find((m) => m.key === screen)?.section ?? null)
  useEffect(() => { if (seccionActiva && abiertas[seccionActiva] === false) setAbiertas((a) => ({ ...a, [seccionActiva]: true })) }, [seccionActiva])   // eslint-disable-line react-hooks/exhaustive-deps
  const estaAbierta = (h: string) => abiertas[h] !== false
  const alternar = (h: string) => setAbiertas((a) => { const n = { ...a, [h]: !estaAbierta(h) }; guardarSecciones(n); return n })

  const go = (key: string) => { setScreen(key); onNavigate?.() }
  // El doctor (cliente) ve un menú plano de pocas entradas: sin encabezados internos ("Hub", "Portal del Doctor"),
  // sin la píldora de rol y sin la firma del operador. Es la cara de la marca.
  const plano = role === 'doctor'

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
      {!plano && <div className="side-role"><Icon name={r.icon} /> {r.label}</div>}

      <nav className="nav">
        {plano && <div className="nav-hub nav-plano">{[...hub, ...modules].map(Link)}</div>}
        {!plano && <>
        {/* Inicio + Avisos/Chat del equipo. En móvil el hub del staff vive en el bottom-nav → se oculta aquí. */}
        {hub.length > 0 && (
          <div className="nav-hub">
            <button type="button" className={`grp grp-btn${estaAbierta(HUB) ? ' abierta' : ''}`} aria-expanded={estaAbierta(HUB)} onClick={() => alternar(HUB)} data-testid={`seccion-${HUB}`}>
              <span>{HUB}</span><ChevronRight size={13} aria-hidden="true" />
            </button>
            {estaAbierta(HUB) && hub.map(Link)}
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
        </>}
      </nav>

      <div className="side-foot">
        {/* 18 oct 2026 (dueño: "roba demasiado espacio"): una sola fila: avatar + nombre (abre el perfil) y dos íconos. */}
        {user && (
          <div className="side-user side-user--compacto">
            <button type="button" className="su-open" title="Editar mi perfil" onClick={() => setProfileOpen(true)}>
              {user.avatarUrl
                ? <img className="su-av" src={user.avatarUrl} alt="" />
                : <span className="su-av">{initials(user.name)}</span>}
              <span className="su-meta">
                <span className="su-name">{user.name.split('·')[0].trim()}</span>
                <span className="su-role">Editar perfil</span>
              </span>
            </button>
            <button className="su-ic" type="button" aria-label="Ajustes" title="Ajustes" onClick={() => setAjustesOpen(true)}>
              <Settings size={16} />
            </button>
            <button className="su-ic" type="button" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => { if (window.confirm('¿Cerrar sesión? Se perderá lo que no hayas guardado (por ejemplo, el carrito).')) logout() }}>
              <LogOut size={16} />
            </button>
          </div>
        )}
        {/* Como en Fukuroll: "Operado por STRYV" en el pie. Dirección lo usa como entrada a su plan STRYV Care;
            el resto del equipo llega a la página de STRYV. El doctor (menú plano) no lo ve. */}
        {!plano && (role === 'admin' ? (
          <button type="button" className={'side-stryv' + (screen === STRYV_CARE_SCREEN.key ? ' on' : '')} onClick={() => go(STRYV_CARE_SCREEN.key)} data-testid="side-stryv">
            <span className="ss-top"><span className="live" /> Operado por <b>STRYV</b></span>
            <span className="side-care">Ver mi plan STRYV Care<span className="ss-arrow" aria-hidden>›</span></span>
          </button>
        ) : (
          <a className="side-stryv side-stryv--link" href="https://stryvstudio.com" target="_blank" rel="noopener noreferrer" aria-label="Operado por STRYV · stryvstudio.com">
            <span className="ss-top"><span className="live" /> Operado por <b>STRYV</b></span>
          </a>
        ))}
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      {ajustesOpen && <Ajustes onClose={() => setAjustesOpen(false)} />}
    </aside>
  )
}

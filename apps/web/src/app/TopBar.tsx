// Barra superior del hub: hamburguesa (móvil), título/subtítulo de la pantalla,
// buscador GLOBAL (indexado, acotado por rol) y campana.
import React, { useMemo, useState } from 'react'
import { Icon } from './icons'
import { getRole, getScreenDef, getNav, COMMON_SCREEN, CHAT_SCREEN } from './roles'
import { useRole } from '../auth/RoleContext'
import { useGlobalSearch } from '../data/hooks/useGlobalSearch'
import { useNotifications } from '../data/hooks/useNotifications'
import { timeAgo } from '../lib/format'

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { role, screen, setScreen } = useRole()
  const r = getRole(role)
  const s = getScreenDef(r, screen)
  const sub =
    screen === COMMON_SCREEN.key ? 'Comunicación interna · equipo'
      : screen === CHAT_SCREEN.key ? 'Mensajes del equipo'
        : r.label

  const search = useGlobalSearch()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(() => (open ? search(q) : []), [open, q, search])

  const go = (toScreen: string) => { setScreen(toScreen); setQ(''); setOpen(false) }

  return (
    <header className="top">
      <button className="hamb" aria-label="Abrir menú" type="button" onClick={onMenu}>
        <Icon name="menu" />
      </button>
      <div>
        <h1 className="screen-title serif">{s.label}</h1>
        <div className="screen-sub">{sub}</div>
      </div>
      <div className="top-r">
        <div style={{ position: 'relative' }}>
          <div className="searchbox">
            <Icon name="search" />
            <input
              placeholder="Buscar pedidos, productos…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            />
          </div>
          {open && q.trim().length >= 2 && (
            <div className="searchpop">
              {results.length === 0 ? (
                <div className="searchpop-empty">Sin resultados para “{q.trim()}”.</div>
              ) : (
                results.map((res) => (
                  <button key={res.type + res.id} type="button" className="searchpop-row" onMouseDown={() => go(res.screen)}>
                    <span className="searchpop-type">{res.type}</span>
                    <span className="searchpop-label">{res.label}</span>
                    {res.sub && <span className="searchpop-sub">{res.sub}</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <NotifBell />
      </div>
    </header>
  )
}

function NotifBell() {
  const { role, setScreen, capabilities } = useRole()
  const { data, markAllRead, markRead } = useNotifications()
  const [open, setOpen] = useState(false)

  const navKeys = useMemo(() => new Set(getNav(getRole(role), undefined, capabilities).map((s) => s.key)), [role, capabilities])
  const visible = useMemo(
    () => data.filter((n) => !n.roles || role === 'admin' || n.roles.includes(role)),
    [data, role],
  )
  const unread = visible.filter((n) => !n.read).length

  const onPick = (id: string, toScreen?: string) => {
    markRead(id)
    if (toScreen && navKeys.has(toScreen)) setScreen(toScreen)
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="icobtn"
        type="button"
        aria-label="Notificaciones"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="bdg" />}
      </button>
      {open && (
        <div className="searchpop">
          <div className="notif-head">
            <span>Notificaciones</span>
            {unread > 0 && (
              <button type="button" className="notif-readall" onMouseDown={() => markAllRead(visible.map((n) => n.id))}>
                Marcar todo leído
              </button>
            )}
          </div>
          {visible.length === 0 ? (
            <div className="searchpop-empty">Sin notificaciones.</div>
          ) : (
            visible.slice(0, 12).map((n) => (
              <button
                key={n.id}
                type="button"
                className={'notif-row' + (n.read ? '' : ' unread')}
                onMouseDown={() => onPick(n.id, n.screen)}
              >
                <span className="notif-dot" data-on={!n.read} />
                <span className="notif-text">{n.text}</span>
                <span className="notif-when">{timeAgo(n.at)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// Barra superior del hub: hamburguesa (móvil), título/subtítulo de la pantalla,
// buscador GLOBAL (indexado, acotado por rol) y campana.
import React, { useMemo, useState } from 'react'
import { Icon } from './icons'
import { getRole, getScreenDef, COMMON_SCREEN, CHAT_SCREEN } from './roles'
import { useRole } from '../auth/RoleContext'
import { useGlobalSearch } from '../data/hooks/useGlobalSearch'

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
        <button className="icobtn" type="button" aria-label="Notificaciones">
          <Icon name="bell" />
          <span className="bdg" />
        </button>
      </div>
    </header>
  )
}

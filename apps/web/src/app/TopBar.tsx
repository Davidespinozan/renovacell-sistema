// Barra superior del hub: hamburguesa (móvil), título/subtítulo de la pantalla,
// buscador GLOBAL (indexado, acotado por rol) y campana.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { BrandLogo } from './BrandLogo'
import { getRole, getScreenDef, getNav, COMMON_SCREEN, CHAT_SCREEN } from './roles'
import { useRole } from '../auth/RoleContext'
import { useGlobalSearch } from '../data/hooks/useGlobalSearch'
import { useNotifications, type Notif } from '../data/hooks/useNotifications'
import { timeAgo } from '../lib/format'
import { currentUserId } from '../lib/supabase'
import { KINDS_COMERCIALES } from '../data/ops/atencionComercial'
import { irAConversacion, irASolicitud } from '../data/store/navIntentStore'

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { role, screen, setScreen, capabilities } = useRole()
  const r = getRole(role)
  // Pasa las capabilities para resolver también el título de las pantallas de
  // capacidad (Diseño/Eventos); si no, caían al primero de la nav ("Inicio").
  const s = getScreenDef(r, screen, undefined, capabilities)
  const sub =
    screen === COMMON_SCREEN.key ? ''
      : screen === CHAT_SCREEN.key ? 'Mensajes del equipo'
        : r.label

  const search = useGlobalSearch()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => (open ? search(q) : []), [open, q, search])

  const go = (toScreen: string) => { setScreen(toScreen); setQ(''); setOpen(false); inputRef.current?.blur() }

  // Atajo global ⌘K / Ctrl+K: enfoca el buscador desde cualquier pantalla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Mantén el índice activo dentro del rango cuando cambian los resultados.
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, results.length - 1))) }, [results.length])

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { const r = results[active]; if (r) go(r.screen) }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  return (
    <header className="top">
      <button className="hamb" aria-label="Abrir menú" type="button" onClick={onMenu}>
        <Icon name="menu" />
      </button>
      <div className="top-title">
        <h1 className="screen-title serif">{s.label}</h1>
        <div className="screen-sub">{sub}</div>
      </div>
      {/* Marca siempre a la vista en teléfono: centrada en la cabecera de todos los roles (en escritorio
          el logo ya está fijo en el menú lateral, así que aquí se oculta por CSS). Decorativa: el nombre
          de la pantalla es el <h1>. */}
      <span className="top-logo" aria-hidden="true"><BrandLogo alt="" /></span>
      <div className="top-r">
        <div style={{ position: 'relative' }}>
          <div className="searchbox">
            <Icon name="search" />
            <input
              ref={inputRef}
              placeholder="Buscar o ir a…  (pedidos, doctores, productos, lotes)"
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }}
              onFocus={() => setOpen(true)}
              onKeyDown={onInputKey}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            />
            <kbd className="kbd-hint" aria-hidden="true">⌘K</kbd>
          </div>
          {open && q.trim().length >= 2 && (
            <div className="searchpop">
              {results.length === 0 ? (
                <div className="searchpop-empty">Sin resultados para “{q.trim()}”.</div>
              ) : (
                results.map((res, i) => (
                  <button
                    key={res.type + res.id}
                    type="button"
                    className={'searchpop-row' + (i === active ? ' active' : '')}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={() => go(res.screen)}
                  >
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
    () => data.filter((n) => {
      // Si la notificación va dirigida a personas (avisos de chat), MANDA sobre el
      // rol: solo sus destinatarios la ven, ni siquiera Dirección. Un mensaje
      // directo es privado entre sus participantes.
      const audienceOk = n.userIds
        ? n.userIds.includes(currentUserId() ?? '')
        : (!n.roles || role === 'admin' || n.roles.includes(role))
      if (!audienceOk) return false
      // Dirección ve todo (supervisión); el resto solo lo que puede abrir.
      return role === 'admin' || !n.screen || navKeys.has(n.screen)
    }),
    [data, role, navKeys],
  )
  const unread = visible.filter((n) => !n.read).length

  // CHV2-B · La campana es HISTORIAL de eventos (no la cola de trabajo). Un aviso comercial abre la
  // conversación/solicitud exacta solo si el destino está en la navegación del rol; la pantalla destino
  // vuelve a validar contra el servidor (un id ajeno o resuelto no revela nada).
  const onPick = (n: Notif) => {
    markRead(n.id)
    if (n.kind && KINDS_COMERCIALES.has(n.kind) && n.conversationId && n.screen && navKeys.has(n.screen)) {
      if (n.screen === 'asesorias') irAConversacion(setScreen, n.conversationId, { origen: 'campana' })
      else if (n.screen === 'av_atencion') irASolicitud(setScreen, n.conversationId, { origen: 'campana' })
      else setScreen(n.screen)
    } else if (n.screen && navKeys.has(n.screen)) setScreen(n.screen)
    setOpen(false)
  }
  const etiqueta = unread > 0 ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'

  // Cierre fiable en táctil: Safari iOS no enfoca un <button> al tocarlo, así que el onBlur nunca
  // dispara y el panel se quedaba abierto (incluso encima de un modal). Se cierra al tocar fuera o con Escape.
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const fuera = (e: Event) => { if (caja.current && !caja.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <div ref={caja} style={{ position: 'relative' }}>
      <button
        className="icobtn"
        type="button"
        aria-label={etiqueta}
        aria-expanded={open}
        title="Notificaciones"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        data-testid="campana"
      >
        <Icon name="bell" />
        {unread > 0 && <span className="bdg bdg-n" data-testid="campana-n" aria-hidden>{unread > 99 ? '99+' : unread}</span>}
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
                onMouseDown={() => onPick(n)}
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

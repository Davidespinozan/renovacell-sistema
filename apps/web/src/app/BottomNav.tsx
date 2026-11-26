// Bottom nav móvil (<900px, vía CSS). Staff: Inicio + Avisos/Chat del equipo (hub); el resto de
// módulos se abren con "Menú". Doctor: Inicio + sus primeros módulos. El Menú siempre está.
import React from 'react'
import { Icon } from './icons'
import { getRole, getNav, HUB_KEYS, INICIO_SCREEN, COMMON_SCREEN, CHAT_SCREEN } from './roles'
import { useRole } from '../auth/RoleContext'
import { usePiezasCarrito } from '../data/store/carritoConteo'
import { pedirRevisarPedido } from '../data/store/catalogoIntento'

function short(label: string, key: string): string {
  if (key === INICIO_SCREEN.key) return 'Inicio'
  if (key === COMMON_SCREEN.key) return 'Avisos'
  if (key === CHAT_SCREEN.key) return 'Chat'
  return label.replace(/^Mis\s+/i, '').replace(/^Por\s+/i, '').split(' (')[0]
}

// Destinos de la barra inferior por rol (en orden; solo los que el rol tiene).
export const BARRA_POR_ROL: Record<string, string[]> = {
  admin: ['inicio', 'g_conversaciones', 'av_ventas', 'g_clientes'], billing: ['inicio', 'g_conversaciones', 'av_ventas', 'g_clientes'], comm: ['inicio', 'g_conversaciones', 'av_ventas', 'g_clientes'],
  pos: ['inicio', 'asesorias', 'caja', 'clientes'],
  warehouse: ['inicio', 'g_pedidos', 'g_inv_alm', 'g_ent_alm'], packing: ['inicio', 'g_pedidos_aux', 'g_inv_aux'],   // MENÚ CORTO (26 nov 2026)
  driver: ['inicio', 'driver_home', 'chat'],
  doctor: ['inicio', 'catalogo', 'g_pedidosdr'],
}
const CORTO_BARRA: Record<string, string> = { g_inv_alm: 'Inventario', g_ent_alm: 'Entradas', g_inv_aux: 'Inventario', g_pedidos: 'Pedidos', g_pedidos_aux: 'Pedidos', caduc: 'Caducar', entradas: 'Recibir', g_conversaciones: 'Mensajes', asesorias: 'Mensajes', caja: 'Vender', surtido: 'Preparar', cola: 'Por enviar', stock: 'Inventario', driver_home: 'Mi ruta', av_ventas: 'Ventas', g_clientes: 'Clientes', g_pedidosdr: 'Pedidos' }

export function BottomNav({ onMenu }: { onMenu: () => void }) {
  const { role, screen, setScreen, capabilities, verified } = useRole()
  const piezas = usePiezasCarrito()   // UX · contador de la pestaña Carrito (doctor)
  const r = getRole(role)
  const nav = getNav(r, undefined, capabilities)
  const hub = nav.filter((s) => HUB_KEYS.has(s.key))

  // El cajón (Sidebar) tiene perfil, ajustes y CERRAR SESIÓN → debe estar SIEMPRE accesible en
  // móvil (antes el doctor, con hub vacío y 4 módulos exactos, se quedaba sin "Menú" y no podía
  // salir). Con el Menú siempre visible, dejamos 3 accesos directos + Menú (4 pestañas máx).
  const showMenu = true
  // UX MODERNO (15 nov 2026, auditoría): la barra lleva el TRABAJO de cada rol (antes Inicio/Avisos/Chat para todos y
  // vender, preparar o la ruta quedaban en "Menú"). Avisos y Chat del equipo siguen en el Menú; el asistente, arriba.
  const preferidas = BARRA_POR_ROL[role ?? ''] ?? null
  const porRol = preferidas ? preferidas.map((k) => nav.find((s) => s.key === k)).filter((s): s is NonNullable<typeof s> => !!s).slice(0, 4) : []
  const primary = porRol.length >= 2 ? porRol : r.isStaff && hub.length > 1 ? hub.slice(0, 3) : nav.slice(0, 3)

  const irCarrito = () => { pedirRevisarPedido(); setScreen('catalogo') }
  // R-36/R-24: enlaces sin href → foco por teclado (role=button, tabIndex) + Enter/Espacio.
  const onKey = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() } }
  return (
    <nav className="bnav">
      {primary.map((s) => (
        <a key={s.key} role="button" tabIndex={0} aria-current={s.key === screen ? 'page' : undefined}
          className={s.key === screen ? 'on' : undefined}
          onClick={() => setScreen(s.key)} onKeyDown={onKey(() => setScreen(s.key))}>
          <Icon name={s.icon} />
          <span>{CORTO_BARRA[s.key] ?? short(s.label, s.key)}</span>
        </a>
      ))}
      {/* UX (referencia: menú de STRYV Restaurant) · el doctor tiene su carrito a un toque, con contador */}
      {role === 'doctor' && verified && (
        <a role="button" tabIndex={0} onClick={irCarrito} onKeyDown={onKey(irCarrito)} data-testid="bnav-carrito" aria-label={piezas ? `Carrito, ${piezas} piezas` : 'Carrito'}>
          <span style={{ position: 'relative', display: 'inline-flex' }}><Icon name="cart" />{piezas > 0 && <span className="bnav-n" data-testid="bnav-carrito-n">{piezas > 99 ? '99+' : piezas}</span>}</span>
          <span>Carrito</span>
        </a>
      )}
      {showMenu && (
        <a role="button" tabIndex={0} onClick={onMenu} onKeyDown={onKey(onMenu)}>
          <Icon name="menu" />
          <span>Menú</span>
        </a>
      )}
    </nav>
  )
}

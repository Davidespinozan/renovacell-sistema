// Registro de pantallas: mapea pantalla -> componente.
// La vista común ('comun') pertenece al add-on Comunicación interna; solo se
// renderiza si el flag está activo. El resto son módulos por rol (hoy Placeholder).
import React from 'react'
import { Placeholder } from './Placeholder'
import { Bandeja } from './Bandeja'
import { Solicitudes } from './Solicitudes'
import { Clientes } from './Clientes'
import { CommonView } from './CommonView'
import { Chat } from './hub/Chat'
import { Catalogo } from './doctor/Catalogo'
import { MisPedidos } from './doctor/MisPedidos'
import { Historial } from './doctor/Historial'
import { Asistente } from './doctor/Asistente'
import { Existencias } from './warehouse/Existencias'
import { Surtido } from './warehouse/Surtido'
import { Caducidades } from './warehouse/Caducidades'
import { Entradas } from './warehouse/Entradas'
import { Cola } from './packing/Cola'
import { Guias } from './packing/Guias'
import { Recibo } from './packing/Recibo'
import { Seguimiento } from './logistics/Seguimiento'
import { MisEntregas } from './driver/MisEntregas'
// Pantallas con recharts: lazy para que la librería no cargue hasta abrirlas.
const Tablero = React.lazy(() => import('./admin/Tablero').then((m) => ({ default: m.Tablero })))
const Ventas = React.lazy(() => import('./admin/Ventas').then((m) => ({ default: m.Ventas })))
import { Trazabilidad } from './admin/Trazabilidad'
import { Doctores } from './admin/Doctores'
import { Prospectos } from './admin/Prospectos'
import { Facturacion } from './admin/Facturacion'
import { Finanzas } from './admin/Finanzas'
import { CierreCaja } from './admin/CierreCaja'
import { Bitacora } from './admin/Bitacora'
import { Reabastecimiento } from './admin/Reabastecimiento'
import { Equipo } from './admin/Equipo'
import { CatalogoAdmin, SitioWeb } from './admin/Contenido'
import { Eventos } from './pos/Eventos'
import { Caja } from './pos/Caja'
import { VentasEvento } from './pos/VentasEvento'
import { COMMON_SCREEN, CHAT_SCREEN, getRole, type RoleKey } from '../app/roles'
import { FEATURES } from '../app/config'
import { Icon } from '../app/icons'

// Pantallas reales ya construidas (por key de pantalla).
const SCREENS: Record<string, () => React.ReactNode> = {
  bandeja: () => <Bandeja />,
  dis_solicitudes: () => <Solicitudes />,
  clientes: () => <Clientes />,
  catalogo: () => <Catalogo />,
  pedidosdr: () => <MisPedidos />,
  hist: () => <Historial />,
  asist: () => <Asistente />,
  stock: () => <Existencias />,
  surtido: () => <Surtido />,
  caduc: () => <Caducidades />,
  entradas: () => <Entradas />,
  cola: () => <Cola />,
  guia: () => <Guias />,
  recibo: () => <Recibo />,
  seguimiento: () => <Seguimiento />,
  driver_home: () => <MisEntregas />,
  tablero: () => <Tablero />,
  av_ventas: () => <Ventas />,
  av_traza: () => <Trazabilidad />,
  av_doc: () => <Doctores />,
  av_prosp: () => <Prospectos />,
  av_fin: () => <Facturacion />,
  av_finanzas: () => <Finanzas />,
  av_cierre: () => <CierreCaja />,
  av_audit: () => <Bitacora />,
  av_inv: () => <Reabastecimiento />,
  compras: () => <Reabastecimiento />,
  av_equipo: () => <Equipo />,
  av_catalogo: () => <CatalogoAdmin />,
  av_sitio: () => <SitioWeb />,
  eventos: () => <Eventos />,
  caja: () => <Caja />,
  vev: () => <VentasEvento />,
}

export function renderScreen(role: RoleKey, screen: string): React.ReactNode {
  if (screen === COMMON_SCREEN.key) {
    if (FEATURES.comunicacionInterna) return <CommonView />
    return <AddOnInactive title="Vista común" addon="Comunicación interna" />
  }
  if (screen === CHAT_SCREEN.key) {
    // Chat = comunicación interna: solo staff. Los doctores (clientes) no lo ven.
    if (!getRole(role).isStaff) return <Placeholder role={role} screen={screen} />
    if (FEATURES.comunicacionInterna) return <Chat />
    return <AddOnInactive title="Chat" addon="Comunicación interna" />
  }
  const real = SCREENS[screen]
  if (real) return <React.Suspense fallback={<div className="card" style={{ color: 'var(--ink-3)' }}>Cargando…</div>}>{real()}</React.Suspense>
  return <Placeholder role={role} screen={screen} />
}

function AddOnInactive({ title, addon }: { title: string; addon: string }) {
  return (
    <div className="grid">
      <div className="eyebrow">Add-on no activo</div>
      <div className="card">
        <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
          <Icon name="shield" />
          <span>
            <b>{title}</b> es parte del módulo <b>{addon}</b>, que no está contratado en este
            entorno. Actívalo en <code>config.ts</code> (FEATURES) para verlo.
          </span>
        </div>
      </div>
    </div>
  )
}

// Registro de pantallas: mapea pantalla -> componente.
// La vista común ('comun') pertenece al add-on Comunicación interna; solo se
// renderiza si el flag está activo. El resto son módulos por rol (hoy Placeholder).
import React, { useEffect } from 'react'
import { useRole } from '../auth/RoleContext'
import { Placeholder } from './Placeholder'
import { Bandeja } from './Bandeja'
import { Solicitudes } from './Solicitudes'
import { Calendario } from './Calendario'
import { Clientes } from './Clientes'
import { CommonView } from './CommonView'
import { Chat } from './hub/Chat'
import { Catalogo } from './doctor/Catalogo'
import { MisPedidos } from './doctor/MisPedidos'
import { Historial } from './doctor/Historial'
import { Existencias } from './warehouse/Existencias'
import { Surtido } from './warehouse/Surtido'
import { Caducidades } from './warehouse/Caducidades'
import { Entradas } from './warehouse/Entradas'
import { Devoluciones } from './warehouse/Devoluciones'
import { Cola } from './packing/Cola'
import { Guias } from './packing/Guias'
import { Recibo } from './packing/Recibo'
import { Seguimiento } from './logistics/Seguimiento'
import { Despacho } from './logistics/Despacho'
import { MisEntregas } from './driver/MisEntregas'
// Pantallas con recharts: lazy para que la librería no cargue hasta abrirlas.
const Tablero = React.lazy(() => import('./admin/Tablero').then((m) => ({ default: m.Tablero })))
const Ventas = React.lazy(() => import('./admin/Ventas').then((m) => ({ default: m.Ventas })))
import { Trazabilidad } from './admin/Trazabilidad'
import { DoctoresDirectorio } from './admin/DoctoresDirectorio'
import { Doctores } from './admin/Doctores' // cockpit de verificación (av_verif); av_doc queda como directorio comercial
import { Prospectos } from './admin/Prospectos'
import { Facturacion } from './admin/Facturacion'
import { PagosPorValidar } from './admin/PagosPorValidar'
import { Finanzas } from './admin/Finanzas'
import { CierreCaja } from './admin/CierreCaja'
import { Bitacora } from './admin/Bitacora'
import { Reabastecimiento } from './admin/Reabastecimiento'
import { ControlInventario } from './admin/ControlInventario'
import { Equipo } from './admin/Equipo'
import { CatalogoAdmin, SitioWeb } from './admin/Contenido'
import { Precios } from './admin/Precios'
import { RevisionFiscal } from './admin/RevisionFiscal'
import { Comunicaciones } from './admin/Comunicaciones'
import { Comisiones } from './admin/Comisiones'
import { Configuracion } from './admin/Configuracion'
import { Conocimiento } from './admin/Conocimiento' // CC-3
import { AtencionComercialPantalla } from './admin/AtencionComercial' // CC-7
import { Mermas } from './admin/Mermas'
import { Importar } from './admin/Importar'
import { Eventos } from './pos/Eventos'
import { MiCustodia } from './sales/MiCustodia'
import { Custodia } from './warehouse/Custodia'
import { Custodias } from './admin/Custodias'
import { Caja } from './pos/Caja'
import { VentasEvento } from './pos/VentasEvento'
import { COMMON_SCREEN, CHAT_SCREEN, getRole, type RoleKey } from '../app/roles'
import { FEATURES } from '../app/config'
import { Icon } from '../app/icons'
import { ChatCanonico } from './chat/ChatCanonico'
import { AsesoriasPantalla } from './chat/Asesorias'
import { RoleHome } from './home/RoleHome'   // CHV2-B · Inicio por rol

// Pantallas reales ya construidas (por key de pantalla).
const SCREENS: Record<string, () => React.ReactNode> = {
  inicio: () => <RoleHome />,   // CHV2-B · entrada de todos los roles
  bandeja: () => <Bandeja />,
  dis_solicitudes: () => <Solicitudes />,
  dis_calendario: () => <Calendario />,
  clientes: () => <Clientes />,
  catalogo: () => <Catalogo />,
  pedidosdr: () => <MisPedidos />,
  hist: () => <Historial />,
  asist: () => <RedirigirChat />,   // UX-1 · alias heredado ('Asistente IA') → la conversación canónica
  stock: () => <Existencias />,
  surtido: () => <Surtido />,
  caduc: () => <Caducidades />,
  entradas: () => <Entradas />,
  devoluciones: () => <Devoluciones />,
  cola: () => <Cola />,
  guia: () => <Guias />,
  recibo: () => <Recibo />,
  seguimiento: () => <Seguimiento />,
  despacho: () => <Despacho />,
  driver_home: () => <MisEntregas />,
  tablero: () => <Tablero />,
  av_ventas: () => <Ventas />,
  av_traza: () => <Trazabilidad />,
  av_doc: () => <DoctoresDirectorio />,
  av_verif: () => <Doctores />, // "Por verificar": gate del canal comercial (profiles.verified)
  av_prosp: () => <Prospectos />,
  av_fin: () => <Facturacion />,
  av_fiscal: () => <RevisionFiscal />,
  av_mensajes: () => <Comunicaciones />,
  av_pagos: () => <PagosPorValidar />,
  av_finanzas: () => <Finanzas />,
  av_cierre: () => <CierreCaja />,
  av_audit: () => <Bitacora />,
  av_inv: () => <Reabastecimiento />,
  compras: () => <Reabastecimiento />,
  av_equipo: () => <Equipo />,
  av_catalogo: () => <CatalogoAdmin />,
  av_precios: () => <Precios />,
  av_comisiones: () => <Comisiones />,
  av_conocimiento: () => <Conocimiento />,
  av_atencion: () => <AtencionComercialPantalla />,   // CC-7
  av_config: () => <Configuracion />,
  av_mermas: () => <Mermas />,
  av_control_inv: () => <ControlInventario />,
  av_import: () => <Importar />,
  av_sitio: () => <SitioWeb />,
  eventos: () => <Eventos />,
  caja: () => <Caja />,
  vev: () => <VentasEvento />,
  consigna: () => <MiCustodia />,
  consigna_alm: () => <Custodia />,
  av_custodias: () => <Custodias />,
  // CC-2 · conversación canónica
  chat_cc: () => <ChatCanonico embebido />,
  asesorias: () => <AsesoriasPantalla />,   // CC-7 · Dirección vs vendedor
}

// UX-1 · Enlaces/recuerdos a la pantalla retirada 'asist' caen en la conversación canónica (sin segunda implementación).
function RedirigirChat() {
  const { setScreen } = useRole()
  useEffect(() => { setScreen('chat_cc') }, [setScreen])
  return null
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

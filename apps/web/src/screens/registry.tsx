// Registro de pantallas: mapea pantalla -> componente.
// La vista común ('comun') pertenece al add-on Comunicación interna; solo se
// renderiza si el flag está activo. El resto son módulos por rol (hoy Placeholder).
import { ClasificarCartera } from './ClasificarCartera'
import { ProductosClientes } from './sales/ProductosClientes'
import { BotonAvisos } from '../app/BotonAvisos'
import { MiVerificacion } from './doctor/MiVerificacion'
import React, { useEffect } from 'react'
import { useRole } from '../auth/RoleContext'
import { Placeholder } from './Placeholder'
import { Bandeja } from './Bandeja'
import { Solicitudes } from './Solicitudes'
import { Calendario } from './Calendario'
import { Clientes } from './Clientes'
import { CommonView } from './CommonView'
import { Chat } from './hub/Chat'
import { StryvCare } from './stryv/StryvCare'
import { Catalogo, CatalogoPantalla } from './doctor/Catalogo'
import { MisPedidos } from './doctor/MisPedidos'
import { Historial } from './doctor/Historial'
import { Existencias } from './warehouse/Existencias'
import { Surtido } from './warehouse/Surtido'
import { HoyAlmacen } from './warehouse/HoyAlmacen'
import { Caducidades } from './warehouse/Caducidades'
import { Entradas } from './warehouse/Entradas'
import { Devoluciones } from './warehouse/Devoluciones'
import { Cola } from './packing/Cola'
import { Guias } from './packing/Guias'
import { Seguimiento } from './logistics/Seguimiento'
import { Despacho } from './logistics/Despacho'
import { MisEntregas } from './driver/MisEntregas'
import { AgendaEntregas } from './logistics/AgendaEntregas'
// Pantallas con recharts: lazy para que la librería no cargue hasta abrirlas.
const Tablero = React.lazy(() => import('./admin/Tablero').then((m) => ({ default: m.Tablero })))
const Ventas = React.lazy(() => import('./admin/Ventas').then((m) => ({ default: m.Ventas })))
import { Trazabilidad } from './admin/Trazabilidad'
import { DoctoresDirectorio } from './admin/DoctoresDirectorio'
import { Doctores } from './admin/Doctores' // cockpit de verificación (av_verif); av_doc queda como directorio comercial
import { Facturacion } from './admin/Facturacion'
import { PagosPorValidar } from './admin/PagosPorValidar'
import { RevisionEconomica } from './admin/RevisionEconomica'   // PAY-EXP-01A-3
import { Finanzas } from './admin/Finanzas'
import { CierreCaja } from './admin/CierreCaja'
import { Bitacora } from './admin/Bitacora'
import { Reabastecimiento } from './admin/Reabastecimiento'
import { ControlInventario } from './admin/ControlInventario'
import { Equipo } from './admin/Equipo'
import { CatalogoAdmin, SitioWeb } from './admin/Contenido'
import { Precios } from './admin/Precios'
import { Promociones } from './admin/Promociones'
import { RevisionFiscal } from './admin/RevisionFiscal'
import { Comunicaciones } from './admin/Comunicaciones'
import { InvitarClientes } from './admin/InvitarClientes'   // INVITA-1
import { Comisiones } from './admin/Comisiones'
import { Configuracion } from './admin/Configuracion'
import { Pestanas } from '../app/Pestanas'
import { Conocimiento } from './admin/Conocimiento' // CC-3
import { ManualVentas } from './admin/ManualVentas' // R4-C10
import { AtencionComercialPantalla, CarteraHorarioPantalla } from './admin/AtencionComercial' // CC-7
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
  catalogo: () => <CatalogoPantalla />,
  pedidosdr: () => <MisPedidos />,
  hist: () => <Historial />,
  g_pedidosdr: () => <Pestanas grupo="g_pedidosdr" pestanas={[{ key: 'pedidosdr', label: 'En curso', render: () => <MisPedidos /> }, { key: 'hist', label: 'Historial', render: () => <Historial /> }]} />,
  asist: () => <RedirigirChat />,   // UX-1 · alias heredado ('Asistente IA') → la conversación canónica
  stock: () => <Existencias />,
  alm_hoy: () => <HoyAlmacen />,   // ALM-1 · sin entrada de menú: Inicio de Almacén la incluye
  surtido: () => <Surtido />,
  caduc: () => <Caducidades />,
  entradas: () => <Entradas />,
  devoluciones: () => <Devoluciones />,
  cola: () => <Cola />,
  guia: () => <Guias />,
  seguimiento: () => <Seguimiento />,
  despacho: () => <Despacho />,
  driver_home: () => <MisEntregas />,
  agenda_entregas: () => <AgendaEntregas />,   // ENT-H · Almacén y Chofer (Dirección la ve como pestaña de Envíos)
  tablero: () => <Tablero />,
  av_ventas: () => <Ventas />,
  av_traza: () => <Trazabilidad />,
  av_doc: () => <DoctoresDirectorio />,
  av_verif: () => <Doctores />, // "Por verificar": gate del canal comercial (profiles.verified)
  av_fin: () => <Facturacion />,
  av_fiscal: () => <RevisionFiscal />,
  av_mensajes: () => <Comunicaciones />,
  av_pagos: () => <PagosPorValidar />,
  av_revision: () => <RevisionEconomica />,
  av_finanzas: () => <Finanzas />,
  av_cierre: () => <CierreCaja />,
  av_audit: () => <Bitacora />,
  av_inv: () => <Reabastecimiento />,
  compras: () => <Reabastecimiento />,
  av_equipo: () => <Equipo />,
  av_catalogo: () => <CatalogoAdmin />,
  av_precios: () => <Precios />,
  av_promociones: () => <Promociones />,   // PROMO-2 · pestaña de Catálogo
  av_comisiones: () => <Comisiones />,
  av_conocimiento: () => <Conocimiento />,
  av_manual_ventas: () => <ManualVentas />,   // R4-C10
  av_atencion: () => <AtencionComercialPantalla />,   // CC-7 · Conversaciones → Bandeja
  av_cartera: () => <CarteraHorarioPantalla />,       // REORG CRM · Equipo → Cartera y horario
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
  chat_cc: () => <ChatCanonico embebido barra={<BotonAvisos />} />,
  mi_verificacion: () => <MiVerificacion />,   // cuenta ≠ verificación
  asesorias: () => <AsesoriasPantalla />,
  productos_clientes: () => <ProductosClientes />,   // HERRAMIENTAS DEL VENDEDOR · quién compró cada producto   // CC-7 · Dirección vs vendedor
  // ── MENÚ DE DIRECCIÓN AGRUPADO (dueño, 17 oct 2026) · una entrada, pestañas internas; las claves sueltas siguen arriba ──
  g_clientes: () => <Pestanas grupo="g_clientes" pestanas={[{ key: 'av_doc', label: 'Clientes', render: () => <DoctoresDirectorio /> }, { key: 'av_verif', label: 'Por verificar', render: () => <Doctores /> }, { key: 'av_invitar', label: 'Invitar clientes', render: () => <InvitarClientes /> }, { key: 'av_clasificar', label: 'Clasificar', render: () => <ClasificarCartera abiertoInicial /> }]} />,
  g_conversaciones: () => <Pestanas grupo="g_conversaciones" pestanas={[{ key: 'av_atencion', label: 'Bandeja', render: () => <AtencionComercialPantalla /> }, { key: 'asesorias', label: 'Asignadas', render: () => <AsesoriasPantalla /> }, { key: 'av_mensajes', label: 'Correos al cliente', render: () => <Comunicaciones /> }]} />,
  g_catalogo: () => <Pestanas grupo="g_catalogo" pestanas={[{ key: 'av_catalogo', label: 'Productos', render: () => <CatalogoAdmin /> }, { key: 'av_precios', label: 'Precios', render: () => <Precios /> }, { key: 'av_promociones', label: 'Promociones', render: () => <Promociones /> }, { key: 'av_conocimiento', label: 'Conocimiento de producto', render: () => <Conocimiento /> }, { key: 'av_manual_ventas', label: 'Manual de ventas', render: () => <ManualVentas /> }]} />,
  av_existencias: () => <Existencias />,
  av_entradas: () => <Entradas />,
  // Dirección corrige conteos al alza y registra entradas sin compra (solo admin en el servidor): antes no tenía cómo llegar.
  g_inventario: () => <Pestanas grupo="g_inventario" pestanas={[{ key: 'av_existencias', label: 'Existencias', render: () => <Existencias /> }, { key: 'av_entradas', label: 'Entradas', render: () => <Entradas /> }, { key: 'av_traza', label: 'Trazabilidad', render: () => <Trazabilidad /> }, { key: 'av_mermas', label: 'Mermas', render: () => <Mermas /> }, { key: 'av_control_inv', label: 'Control de inventario', render: () => <ControlInventario /> }, { key: 'av_custodias', label: 'Custodias', render: () => <Custodias /> }]} />,
  g_envios: () => <Pestanas grupo="g_envios" pestanas={[{ key: 'despacho', label: 'Despacho', render: () => <Despacho /> }, { key: 'seguimiento', label: 'Seguimiento', render: () => <Seguimiento /> }, { key: 'agenda_entregas', label: 'Horarios de entrega', render: () => <AgendaEntregas sinTitulo /> }]} />,
  g_finanzas: () => <Pestanas grupo="g_finanzas" pestanas={[{ key: 'av_finanzas', label: 'Finanzas', render: () => <Finanzas /> }, { key: 'av_cierre', label: 'Cierre de caja', render: () => <CierreCaja /> }]} />,
  g_cobros: () => <Pestanas grupo="g_cobros" pestanas={[{ key: 'av_pagos', label: 'Pagos por validar', render: () => <PagosPorValidar /> }, { key: 'av_revision', label: 'Revisión económica', render: () => <RevisionEconomica /> }]} />,
  g_facturacion: () => <Pestanas grupo="g_facturacion" pestanas={[{ key: 'av_fin', label: 'Facturación', render: () => <Facturacion /> }, { key: 'av_fiscal', label: 'Revisión fiscal', render: () => <RevisionFiscal /> }]} />,
  g_equipo: () => <Pestanas grupo="g_equipo" pestanas={[{ key: 'av_equipo', label: 'Personas', render: () => <Equipo /> }, { key: 'av_cartera', label: 'Cartera y horario', render: () => <CarteraHorarioPantalla /> }, { key: 'av_comisiones', label: 'Metas y comisiones', render: () => <Comisiones /> }]} />,
  g_sistema: () => <Pestanas grupo="g_sistema" pestanas={[{ key: 'av_config', label: 'Configuración', render: () => <Configuracion /> }, { key: 'av_audit', label: 'Bitácora', render: () => <Bitacora /> }]} />,
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
  // STRYV Care: solo Dirección (la Edge también lo exige; aquí no se muestra a nadie más).
  if (screen === 'stryv_care') return role === 'admin' ? <StryvCare /> : <Placeholder role={role} screen={screen} />
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

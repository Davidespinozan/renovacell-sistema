// Registro de pantallas: mapea pantalla -> componente.
// La vista común ('comun') pertenece al add-on Comunicación interna; solo se
// renderiza si el flag está activo. El resto son módulos por rol (hoy Placeholder).
import { BotonAvisos } from '../app/BotonAvisos'
import React, { useEffect } from 'react'
import { useRole } from '../auth/RoleContext'
import { Placeholder } from './Placeholder'
// Pantallas con recharts: lazy para que la librería no cargue hasta abrirlas.
const Tablero = lazyPantalla(() => import('./admin/Tablero').then((m) => m.Tablero))
const Ventas = lazyPantalla(() => import('./admin/Ventas').then((m) => m.Ventas))
import { Pestanas } from '../app/Pestanas'
import { COMMON_SCREEN, CHAT_SCREEN, getRole, type RoleKey } from '../app/roles'
import { FEATURES } from '../app/config'
import { Icon } from '../app/icons'
import { RoleHome } from './home/RoleHome'   // CHV2-B · Inicio por rol
import { lazyPantalla } from '../app/lazyPantalla'

// PERF · pantallas bajo demanda (antes todas viajaban en el paquete inicial, ~460 KB gz). Inicio y Placeholder quedan
// directos: son lo primero que se ve.
const Seguimientos = lazyPantalla(() => import('./Seguimientos').then((m) => m.Seguimientos))
const ClasificarCartera = lazyPantalla(() => import('./ClasificarCartera').then((m) => m.ClasificarCartera))
const ProductosClientes = lazyPantalla(() => import('./sales/ProductosClientes').then((m) => m.ProductosClientes))
const MiVerificacion = lazyPantalla(() => import('./doctor/MiVerificacion').then((m) => m.MiVerificacion))
const Bandeja = lazyPantalla(() => import('./Bandeja').then((m) => m.Bandeja))
const Solicitudes = lazyPantalla(() => import('./Solicitudes').then((m) => m.Solicitudes))
const Calendario = lazyPantalla(() => import('./Calendario').then((m) => m.Calendario))
const Clientes = lazyPantalla(() => import('./Clientes').then((m) => m.Clientes))
const CommonView = lazyPantalla(() => import('./CommonView').then((m) => m.CommonView))
const Chat = lazyPantalla(() => import('./hub/Chat').then((m) => m.Chat))
const StryvCare = lazyPantalla(() => import('./stryv/StryvCare').then((m) => m.StryvCare))
const Catalogo = lazyPantalla(() => import('./doctor/Catalogo').then((m) => m.Catalogo))
const CatalogoPantalla = lazyPantalla(() => import('./doctor/Catalogo').then((m) => m.CatalogoPantalla))
const MisPedidos = lazyPantalla(() => import('./doctor/MisPedidos').then((m) => m.MisPedidos))
const Historial = lazyPantalla(() => import('./doctor/Historial').then((m) => m.Historial))
const Existencias = lazyPantalla(() => import('./warehouse/Existencias').then((m) => m.Existencias))
const Surtido = lazyPantalla(() => import('./warehouse/Surtido').then((m) => m.Surtido))
const HoyAlmacen = lazyPantalla(() => import('./warehouse/HoyAlmacen').then((m) => m.HoyAlmacen))
const Caducidades = lazyPantalla(() => import('./warehouse/Caducidades').then((m) => m.Caducidades))
const Entradas = lazyPantalla(() => import('./warehouse/Entradas').then((m) => m.Entradas))
const Devoluciones = lazyPantalla(() => import('./warehouse/Devoluciones').then((m) => m.Devoluciones))
const Cola = lazyPantalla(() => import('./packing/Cola').then((m) => m.Cola))
const Guias = lazyPantalla(() => import('./packing/Guias').then((m) => m.Guias))
const Seguimiento = lazyPantalla(() => import('./logistics/Seguimiento').then((m) => m.Seguimiento))
const Despacho = lazyPantalla(() => import('./logistics/Despacho').then((m) => m.Despacho))
const MisEntregas = lazyPantalla(() => import('./driver/MisEntregas').then((m) => m.MisEntregas))
const AgendaEntregas = lazyPantalla(() => import('./logistics/AgendaEntregas').then((m) => m.AgendaEntregas))
const Trazabilidad = lazyPantalla(() => import('./admin/Trazabilidad').then((m) => m.Trazabilidad))
const DoctoresDirectorio = lazyPantalla(() => import('./admin/DoctoresDirectorio').then((m) => m.DoctoresDirectorio))
const Doctores = lazyPantalla(() => import('./admin/Doctores').then((m) => m.Doctores)) // cockpit de verificación (av_verif); av_doc queda como directorio comercial
const Facturacion = lazyPantalla(() => import('./admin/Facturacion').then((m) => m.Facturacion))
const PagosPorValidar = lazyPantalla(() => import('./admin/PagosPorValidar').then((m) => m.PagosPorValidar))
const RevisionEconomica = lazyPantalla(() => import('./admin/RevisionEconomica').then((m) => m.RevisionEconomica))   // PAY-EXP-01A-3
const Finanzas = lazyPantalla(() => import('./admin/Finanzas').then((m) => m.Finanzas))
const CierreCaja = lazyPantalla(() => import('./admin/CierreCaja').then((m) => m.CierreCaja))
const Bitacora = lazyPantalla(() => import('./admin/Bitacora').then((m) => m.Bitacora))
const Reabastecimiento = lazyPantalla(() => import('./admin/Reabastecimiento').then((m) => m.Reabastecimiento))
const ControlInventario = lazyPantalla(() => import('./admin/ControlInventario').then((m) => m.ControlInventario))
const Equipo = lazyPantalla(() => import('./admin/Equipo').then((m) => m.Equipo))
const CatalogoAdmin = lazyPantalla(() => import('./admin/Contenido').then((m) => m.CatalogoAdmin))
const SitioWeb = lazyPantalla(() => import('./admin/Contenido').then((m) => m.SitioWeb))
const Precios = lazyPantalla(() => import('./admin/Precios').then((m) => m.Precios))
const Promociones = lazyPantalla(() => import('./admin/Promociones').then((m) => m.Promociones))
const RevisionFiscal = lazyPantalla(() => import('./admin/RevisionFiscal').then((m) => m.RevisionFiscal))
const Comunicaciones = lazyPantalla(() => import('./admin/Comunicaciones').then((m) => m.Comunicaciones))
const InvitarClientes = lazyPantalla(() => import('./admin/InvitarClientes').then((m) => m.InvitarClientes))   // INVITA-1
const Comisiones = lazyPantalla(() => import('./admin/Comisiones').then((m) => m.Comisiones))
const Configuracion = lazyPantalla(() => import('./admin/Configuracion').then((m) => m.Configuracion))
const Conocimiento = lazyPantalla(() => import('./admin/Conocimiento').then((m) => m.Conocimiento)) // CC-3
const ManualVentas = lazyPantalla(() => import('./admin/ManualVentas').then((m) => m.ManualVentas)) // R4-C10
const AtencionComercialPantalla = lazyPantalla(() => import('./admin/AtencionComercial').then((m) => m.AtencionComercialPantalla)) // CC-7
const CarteraHorarioPantalla = lazyPantalla(() => import('./admin/AtencionComercial').then((m) => m.CarteraHorarioPantalla)) // CC-7
const Mermas = lazyPantalla(() => import('./admin/Mermas').then((m) => m.Mermas))
const Importar = lazyPantalla(() => import('./admin/Importar').then((m) => m.Importar))
const Eventos = lazyPantalla(() => import('./pos/Eventos').then((m) => m.Eventos))
const MiCustodia = lazyPantalla(() => import('./sales/MiCustodia').then((m) => m.MiCustodia))
const Custodia = lazyPantalla(() => import('./warehouse/Custodia').then((m) => m.Custodia))
const Custodias = lazyPantalla(() => import('./admin/Custodias').then((m) => m.Custodias))
const Caja = lazyPantalla(() => import('./pos/Caja').then((m) => m.Caja))
const VentasEvento = lazyPantalla(() => import('./pos/VentasEvento').then((m) => m.VentasEvento))
const ChatCanonico = lazyPantalla(() => import('./chat/ChatCanonico').then((m) => m.ChatCanonico))
const AsesoriasPantalla = lazyPantalla(() => import('./chat/Asesorias').then((m) => m.AsesoriasPantalla))

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
  productos_clientes: () => <ProductosClientes />,
  seguimientos: () => <Seguimientos />,   // HERRAMIENTAS DEL VENDEDOR · pendientes por retomar   // HERRAMIENTAS DEL VENDEDOR · quién compró cada producto   // CC-7 · Dirección vs vendedor
  // ── MENÚ DE DIRECCIÓN AGRUPADO (dueño, 17 oct 2026) · una entrada, pestañas internas; las claves sueltas siguen arriba ──
  g_clientes: () => <Pestanas grupo="g_clientes" pestanas={[{ key: 'av_doc', label: 'Clientes', render: () => <DoctoresDirectorio /> }, { key: 'av_verif', label: 'Por verificar', render: () => <Doctores /> }, { key: 'av_invitar', label: 'Invitar clientes', render: () => <InvitarClientes /> }, { key: 'av_clasificar', label: 'Clasificar', render: () => <ClasificarCartera abiertoInicial /> }]} />,
  g_conversaciones: () => <Pestanas grupo="g_conversaciones" pestanas={[{ key: 'av_atencion', label: 'Bandeja', render: () => <AtencionComercialPantalla /> }, { key: 'asesorias', label: 'Asignadas', render: () => <AsesoriasPantalla /> }, { key: 'av_mensajes', label: 'Correos al cliente', render: () => <Comunicaciones /> }, { key: 'seguimientos', label: 'Pendientes', render: () => <Seguimientos /> }]} />,
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

const conCarga = (el: React.ReactNode) => <React.Suspense fallback={<div className="card" style={{ color: 'var(--ink-3)' }}>Cargando…</div>}>{el}</React.Suspense>

export function renderScreen(role: RoleKey, screen: string): React.ReactNode {
  if (screen === COMMON_SCREEN.key) {
    if (FEATURES.comunicacionInterna) return conCarga(<CommonView />)
    return <AddOnInactive title="Vista común" addon="Comunicación interna" />
  }
  if (screen === CHAT_SCREEN.key) {
    // Chat = comunicación interna: solo staff. Los doctores (clientes) no lo ven.
    if (!getRole(role).isStaff) return <Placeholder role={role} screen={screen} />
    if (FEATURES.comunicacionInterna) return conCarga(<Chat />)
    return <AddOnInactive title="Chat" addon="Comunicación interna" />
  }
  // STRYV Care: solo Dirección (la Edge también lo exige; aquí no se muestra a nadie más).
  if (screen === 'stryv_care') return role === 'admin' ? conCarga(<StryvCare />) : <Placeholder role={role} screen={screen} />
  const real = SCREENS[screen]
  if (real) return conCarga(real())
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

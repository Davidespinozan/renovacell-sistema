// Modelo del HUB base ("el sistema": una base, varias puertas).
//
// - El hub base es NEUTRO; el marco (sidebar/topbar) permanece y el contenido
//   cambia al módulo según el rol.
// - CHV2-B · INICIO es la entrada de TODOS los roles (staff y doctor): "qué requiere mi atención
//   ahora". Es parte del hub base (no depende de add-ons) y se arma con RoleHome.
// - La VISTA COMÚN (anuncios/avisos/biblioteca) es el add-on "Comunicación interna" (flag en
//   config.ts) y ahora se llama "Avisos del equipo": ya no es dueña de "Inicio".
// - DOCTOR nunca ve la vista común (contenido del equipo).
import type { IconName } from './icons'
import { FEATURES, type Features } from './config'

export type RoleKey =
  | 'admin' | 'doctor' | 'warehouse' | 'pos' | 'driver'

// Responsabilidades que Administración suma a un usuario sobre su rol base.
export type CapabilityKey = 'diseno' | 'eventos' | 'anuncios' | 'contenido' | 'conversaciones' | 'nuevos_clientes'

export interface ScreenDef {
  key: string
  label: string
  icon: IconName
  section?: string // agrupa los módulos del sidebar (evita el "muro" de links)
}

export interface RoleDef {
  key: RoleKey
  label: string
  group: string
  icon: IconName
  isStaff: boolean                       // staff puede ver la vista común; el doctor no
  modules: ScreenDef[]                   // módulos propios del rol (SIN la vista común)
  ready: boolean                         // false = pendiente de spec
  requiresFeature?: keyof Features       // el rol existe solo si el add-on está activo
}

// CHV2-B · INICIO (RoleHome) es de todos los roles. La VISTA COMÚN ("Avisos del equipo") y el CHAT
// interno ("Chat del equipo") pertenecen al add-on "Comunicación interna" (hub). Las keys no cambian
// (avisos existentes apuntan a 'comun'/'chat').
export const INICIO_SCREEN: ScreenDef = { key: 'inicio', label: 'Inicio', icon: 'home' }
export const COMMON_SCREEN: ScreenDef = { key: 'comun', label: 'Avisos del equipo', icon: 'megaphone' }
export const CHAT_SCREEN: ScreenDef = { key: 'chat', label: 'Chat del equipo', icon: 'chat' }
export const HUB_SCREENS: ScreenDef[] = [COMMON_SCREEN, CHAT_SCREEN]
// Claves que el marco agrupa arriba ("Hub Renovacell" en el sidebar; pestañas del bottom-nav del staff).
export const HUB_KEYS: ReadonlySet<string> = new Set([INICIO_SCREEN.key, ...HUB_SCREENS.map((s) => s.key)])

export const ROLES: RoleDef[] = [
  {
    key: 'admin', label: 'Administración', group: 'Administración · Dirección',
    icon: 'dashboard', isStaff: true, ready: true,
    modules: [
      { key: 'bandeja', label: 'Mi bandeja', icon: 'check', section: 'Mi trabajo' },
      { key: 'tablero', label: 'Tablero', icon: 'dashboard', section: 'Mi trabajo' },
      { key: 'av_equipo', label: 'Equipo', icon: 'usercheck', section: 'Mi trabajo' },
      { key: 'av_ventas', label: 'Ventas', icon: 'chart', section: 'Comercial' },
      { key: 'av_prosp', label: 'Prospectos', icon: 'grid', section: 'Comercial' },
      // Flujo natural: Prospecto → Por verificar → Doctor. Comisiones no interrumpe.
      { key: 'av_verif', label: 'Por verificar', icon: 'shield', section: 'Comercial' },
      { key: 'av_doc', label: 'Doctores', icon: 'usercheck', section: 'Comercial' },
      { key: 'av_comisiones', label: 'Comisiones', icon: 'chart', section: 'Comercial' },
      { key: 'av_catalogo', label: 'Catálogo', icon: 'bag', section: 'Comercial' },
      { key: 'av_precios', label: 'Precios', icon: 'receipt', section: 'Comercial' },
      { key: 'av_sitio', label: 'Sitio web', icon: 'image', section: 'Comercial' },
      { key: 'av_inv', label: 'Compras a proveedores', icon: 'cart', section: 'Operación' },   // UX-2 · mismo nombre que en Almacén
      { key: 'av_traza', label: 'Trazabilidad', icon: 'fingerprint', section: 'Operación' },
      { key: 'av_mermas', label: 'Mermas', icon: 'box', section: 'Operación' },
      { key: 'av_control_inv', label: 'Control de inventario', icon: 'shield', section: 'Operación' },
      { key: 'av_custodias', label: 'Custodias', icon: 'box', section: 'Operación' },
      { key: 'asesorias', label: 'Conversaciones', icon: 'chat', section: 'Operación' },   // CC-2 · CHV2-B: etiqueta visible "Conversaciones" (la key sigue siendo 'asesorias')
      { key: 'av_atencion', label: 'Atención comercial', icon: 'chat', section: 'Operación' },   // CC-7 · cartera, ruteo y pendientes
      { key: 'av_import', label: 'Importar / Migración', icon: 'download', section: 'Operación' },
      { key: 'despacho', label: 'Despacho', icon: 'truck', section: 'Operación' },
      { key: 'seguimiento', label: 'Seguimiento', icon: 'truck', section: 'Operación' },
      { key: 'av_mensajes', label: 'Mensajes al cliente', icon: 'chat', section: 'Operación' },
      { key: 'av_finanzas', label: 'Finanzas', icon: 'dashboard', section: 'Finanzas' },
      { key: 'av_pagos', label: 'Pagos por validar', icon: 'receipt', section: 'Finanzas' },
      { key: 'av_fin', label: 'Facturación', icon: 'receipt', section: 'Finanzas' },
      { key: 'av_fiscal', label: 'Revisión fiscal', icon: 'shield', section: 'Finanzas' },
      { key: 'av_cierre', label: 'Cierre de caja', icon: 'store', section: 'Finanzas' },
      { key: 'av_audit', label: 'Bitácora', icon: 'shield', section: 'Finanzas' },
      { key: 'av_conocimiento', label: 'Conocimiento de producto', icon: 'grid', section: 'Sistema' },   // CC-3
      { key: 'av_config', label: 'Configuración', icon: 'store', section: 'Sistema' },
    ],
  },
  {
    key: 'doctor', label: 'Portal del Doctor', group: 'Portal del Doctor',
    icon: 'bag', isStaff: false, ready: true,
    modules: [
      { key: 'catalogo', label: 'Catálogo', icon: 'grid' },
      { key: 'pedidosdr', label: 'Mis pedidos', icon: 'bag' },
      { key: 'hist', label: 'Historial', icon: 'clock' },
      // UX-1 · UNA sola conversación con Renovacell (IA + asesor humano en el mismo hilo). El antiguo
      // 'asist' (Asistente IA) ya no es módulo: su clave sigue resolviendo a esta pantalla (alias).
      { key: 'chat_cc', label: 'Habla con Renovacell', icon: 'chat' },
    ],
  },
  {
    // Almacén y Empaque los ve la MISMA persona (Alberto) → un solo rol.
    key: 'warehouse', label: 'Almacén / Empaque', group: 'Almacén y Empaque · Alberto',
    icon: 'box', isStaff: true, ready: true,
    modules: [
      { key: 'bandeja', label: 'Mi bandeja', icon: 'check', section: 'Mi trabajo' },
      { key: 'stock', label: 'Lo que hay en almacén', icon: 'box', section: 'Almacén' },
      { key: 'surtido', label: 'Preparar pedidos', icon: 'layers', section: 'Almacén' },
      { key: 'caduc', label: 'Por caducar', icon: 'clock', section: 'Almacén' },
      { key: 'entradas', label: 'Recibir mercancía', icon: 'download', section: 'Almacén' },   // UX-2 · recepción física de compras
      { key: 'compras', label: 'Compras a proveedores', icon: 'cart', section: 'Almacén' },
      { key: 'devoluciones', label: 'Devoluciones y reingresos', icon: 'box', section: 'Almacén' },
      { key: 'consigna_alm', label: 'Custodia', icon: 'box', section: 'Almacén' },
      { key: 'cola', label: 'Por empacar', icon: 'pkg', section: 'Empaque' },
      { key: 'despacho', label: 'Despacho', icon: 'truck', section: 'Empaque' },
      { key: 'guia', label: 'Guías', icon: 'truck', section: 'Empaque' },
      { key: 'recibo', label: 'Recibo de entrega', icon: 'receipt', section: 'Empaque' },
      { key: 'seguimiento', label: 'Seguimiento', icon: 'truck', section: 'Empaque' },
    ],
  },
  {
    // Vendedor de campo: cada quien ve SOLO su cartera (aislado por vendedor).
    key: 'pos', label: 'Ventas', group: 'Ventas · Campo',
    icon: 'bag', isStaff: true, ready: true,
    modules: [
      { key: 'bandeja', label: 'Mi bandeja', icon: 'check', section: 'Mi trabajo' },
      { key: 'caja', label: 'Punto de venta', icon: 'store', section: 'Vender' },
      { key: 'av_prosp', label: 'Prospectos', icon: 'grid', section: 'Mi cartera' },
      { key: 'clientes', label: 'Clientes', icon: 'usercheck', section: 'Mi cartera' },
      { key: 'consigna', label: 'Mi inventario', icon: 'box', section: 'Mi cartera' },
      { key: 'seguimiento', label: 'Seguimiento', icon: 'truck', section: 'Mi cartera' },
    ],
  },
  {
    key: 'driver', label: 'Chofer', group: 'Chofer · Entregas',
    icon: 'truck', isStaff: true, ready: true, requiresFeature: 'chofer',
    modules: [
      { key: 'driver_home', label: 'Chofer / Seguimiento', icon: 'truck' },
    ],
  },
]

// Capabilities (responsabilidades) que Admin asigna por usuario. Suman módulos
// al rol base. Una persona puede tener varias (p. ej. Almacén + Diseño).
export interface CapabilityDef { key: CapabilityKey; label: string; modules: ScreenDef[] }
export const CAPABILITIES: CapabilityDef[] = [
  {
    key: 'diseno', label: 'Diseño',
    modules: [
      { key: 'dis_solicitudes', label: 'Solicitudes de recurso', icon: 'image', section: 'Diseño' },
      { key: 'dis_calendario', label: 'Calendario', icon: 'dashboard', section: 'Diseño' },
    ],
  },
  {
    key: 'eventos', label: 'Eventos',
    modules: [
      { key: 'eventos', label: 'Eventos', icon: 'store', section: 'Eventos' },
      { key: 'caja', label: 'Caja', icon: 'store', section: 'Eventos' },
      { key: 'vev', label: 'Ventas desde custodia', icon: 'grid', section: 'Eventos' },
    ],
  },
  // Sin módulos propios: es un permiso (publicar/gestionar anuncios en Vista Común).
  { key: 'anuncios', label: 'Anuncios', modules: [] },
  {
    // CC-2 · Atender la conversación canónica con doctores/visitantes (solo vendedores a los que
    // Dirección se lo asigne; Dirección siempre puede). El servidor exige esta capability.
    key: 'conversaciones', label: 'Atender conversaciones',
    modules: [{ key: 'asesorias', label: 'Conversaciones', icon: 'chat', section: 'Mi cartera' }],   // CHV2-B · etiqueta visible
  },
  // CC-7 · Sin módulos: permite que Dirección le asigne clientes NUEVOS (sin él conserva su cartera actual).
  { key: 'nuevos_clientes', label: 'Recibir clientes nuevos', modules: [] },
  {
    key: 'contenido', label: 'Catálogo y sitio web',
    modules: [
      { key: 'av_catalogo', label: 'Catálogo', icon: 'bag', section: 'Comercial' },
      { key: 'av_sitio', label: 'Sitio web', icon: 'image', section: 'Comercial' },
    ],
  },
]
export const getCapability = (k: CapabilityKey): CapabilityDef | undefined => CAPABILITIES.find((c) => c.key === k)
export const capabilityModules = (caps: string[]): ScreenDef[] =>
  caps.flatMap((k) => getCapability(k as CapabilityKey)?.modules ?? [])

export const getRole = (key: RoleKey): RoleDef =>
  ROLES.find((r) => r.key === key) ?? ROLES[0]

// Roles disponibles según los add-ons contratados (oculta comm/driver si no aplican).
export const availableRoles = (features: Features = FEATURES): RoleDef[] =>
  ROLES.filter((r) => !r.requiresFeature || features[r.requiresFeature])

// Navegación visible: [Inicio, avisos/chat del equipo (staff con add-on), ...módulos del rol,
// ...módulos de sus capabilities]. Las capabilities las asigna Administración por usuario.
export const getNav = (role: RoleDef, features: Features = FEATURES, capabilities: string[] = []): ScreenDef[] => {
  const nav: ScreenDef[] = [INICIO_SCREEN]
  if (role.isStaff && features.comunicacionInterna) nav.push(...HUB_SCREENS)
  nav.push(...role.modules)
  const have = new Set(nav.map((s) => s.key))
  capabilityModules(capabilities).forEach((m) => { if (!have.has(m.key)) { nav.push(m); have.add(m.key) } })
  return nav
}

// Pantalla de entrada tras "login": la primera de su navegación (CHV2-B: Inicio para todos).
export const getEntryScreen = (role: RoleDef, features: Features = FEATURES, capabilities: string[] = []): string =>
  getNav(role, features, capabilities)[0]?.key ?? INICIO_SCREEN.key

// Resuelve un ScreenDef por key dentro del alcance del rol + capabilities.
export const getScreenDef = (role: RoleDef, key: string, features: Features = FEATURES, capabilities: string[] = []): ScreenDef => {
  const nav = getNav(role, features, capabilities)
  return nav.find((s) => s.key === key) ?? nav[0] ?? INICIO_SCREEN
}

// Quién puede gestionar la vista común (crear/editar anuncios/avisos/assets):
// Administración. El resto del staff la ve en modo lectura.
export const canManageHub = (key: RoleKey): boolean => key === 'admin'

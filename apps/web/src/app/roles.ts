// Modelo del HUB base ("el sistema": una base, varias puertas).
//
// - El hub base es NEUTRO; el marco (sidebar/topbar) permanece y el contenido
//   cambia al módulo según el rol.
// - La VISTA COMÚN (anuncios/avisos/biblioteca) NO es el contenedor: es el add-on
//   "Comunicación interna", que se activa con un flag (ver config.ts). Cuando está
//   activo, es la home del staff; cuando no, el staff entra a su primer módulo.
// - DOCTOR entra directo a su Portal y nunca ve la vista común (contenido del equipo).
import type { IconName } from './icons'
import { FEATURES, type Features } from './config'

export type RoleKey =
  | 'admin' | 'doctor' | 'warehouse' | 'pos' | 'driver'

// Responsabilidades que Administración suma a un usuario sobre su rol base.
export type CapabilityKey = 'diseno' | 'eventos' | 'anuncios' | 'contenido'

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

// La VISTA COMÚN y el CHAT pertenecen al add-on "Comunicación interna" (hub).
export const COMMON_SCREEN: ScreenDef = { key: 'comun', label: 'Inicio', icon: 'home' }
export const CHAT_SCREEN: ScreenDef = { key: 'chat', label: 'Chat', icon: 'chat' }
export const HUB_SCREENS: ScreenDef[] = [COMMON_SCREEN, CHAT_SCREEN]

export const ROLES: RoleDef[] = [
  {
    key: 'admin', label: 'Administración', group: 'Administración · Dirección',
    icon: 'dashboard', isStaff: true, ready: true,
    modules: [
      { key: 'bandeja', label: 'Mi bandeja', icon: 'check', section: 'Inicio' },
      { key: 'tablero', label: 'Tablero', icon: 'dashboard', section: 'Inicio' },
      { key: 'av_equipo', label: 'Equipo', icon: 'usercheck', section: 'Inicio' },
      { key: 'av_ventas', label: 'Ventas', icon: 'chart', section: 'Comercial' },
      { key: 'av_prosp', label: 'Prospectos', icon: 'grid', section: 'Comercial' },
      { key: 'av_doc', label: 'Doctores', icon: 'usercheck', section: 'Comercial' },
      { key: 'av_catalogo', label: 'Catálogo', icon: 'bag', section: 'Comercial' },
      { key: 'av_sitio', label: 'Sitio web', icon: 'image', section: 'Comercial' },
      { key: 'av_inv', label: 'Inventario', icon: 'box', section: 'Operación' },
      { key: 'av_traza', label: 'Trazabilidad', icon: 'fingerprint', section: 'Operación' },
      { key: 'seguimiento', label: 'Seguimiento', icon: 'truck', section: 'Operación' },
      { key: 'av_finanzas', label: 'Finanzas', icon: 'dashboard', section: 'Finanzas' },
      { key: 'av_fin', label: 'Facturación', icon: 'receipt', section: 'Finanzas' },
      { key: 'av_cierre', label: 'Cierre de caja', icon: 'store', section: 'Finanzas' },
      { key: 'av_audit', label: 'Bitácora', icon: 'shield', section: 'Finanzas' },
    ],
  },
  {
    key: 'doctor', label: 'Portal del Doctor', group: 'Portal del Doctor',
    icon: 'bag', isStaff: false, ready: true,
    modules: [
      { key: 'catalogo', label: 'Catálogo', icon: 'grid' },
      { key: 'pedidosdr', label: 'Mis pedidos', icon: 'bag' },
      { key: 'hist', label: 'Historial', icon: 'clock' },
      { key: 'asist', label: 'Asistente IA', icon: 'chat' },
    ],
  },
  {
    // Almacén y Empaque los ve la MISMA persona (Alberto) → un solo rol.
    key: 'warehouse', label: 'Almacén / Empaque', group: 'Almacén y Empaque · Alberto',
    icon: 'box', isStaff: true, ready: true,
    modules: [
      { key: 'bandeja', label: 'Mi bandeja', icon: 'check', section: 'Inicio' },
      { key: 'stock', label: 'Lo que hay en almacén', icon: 'box', section: 'Almacén' },
      { key: 'surtido', label: 'Preparar pedidos', icon: 'layers', section: 'Almacén' },
      { key: 'caduc', label: 'Por caducar', icon: 'clock', section: 'Almacén' },
      { key: 'entradas', label: 'Registrar entradas', icon: 'download', section: 'Almacén' },
      { key: 'compras', label: 'Compras', icon: 'cart', section: 'Almacén' },
      { key: 'consigna_alm', label: 'Consignación', icon: 'box', section: 'Almacén' },
      { key: 'cola', label: 'Por empacar', icon: 'pkg', section: 'Empaque' },
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
      { key: 'bandeja', label: 'Mi bandeja', icon: 'check', section: 'Inicio' },
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
    modules: [{ key: 'dis_solicitudes', label: 'Solicitudes de recurso', icon: 'image', section: 'Diseño' }],
  },
  {
    key: 'eventos', label: 'Eventos',
    modules: [
      { key: 'eventos', label: 'Eventos', icon: 'store', section: 'Eventos' },
      { key: 'caja', label: 'Caja', icon: 'store', section: 'Eventos' },
      { key: 'vev', label: 'Ventas del evento', icon: 'grid', section: 'Eventos' },
    ],
  },
  // Sin módulos propios: es un permiso (publicar/gestionar anuncios en Vista Común).
  { key: 'anuncios', label: 'Anuncios', modules: [] },
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

// Navegación visible: staff = [vista común (si add-on), ...módulos del rol,
// ...módulos de sus capabilities]; doctor = módulos. Las capabilities las asigna
// Administración por usuario.
export const getNav = (role: RoleDef, features: Features = FEATURES, capabilities: string[] = []): ScreenDef[] => {
  const nav: ScreenDef[] = []
  if (role.isStaff && features.comunicacionInterna) nav.push(...HUB_SCREENS)
  nav.push(...role.modules)
  const have = new Set(nav.map((s) => s.key))
  capabilityModules(capabilities).forEach((m) => { if (!have.has(m.key)) { nav.push(m); have.add(m.key) } })
  return nav
}

// Pantalla de entrada tras "login": la primera de su navegación.
export const getEntryScreen = (role: RoleDef, features: Features = FEATURES, capabilities: string[] = []): string =>
  getNav(role, features, capabilities)[0]?.key ?? COMMON_SCREEN.key

// Resuelve un ScreenDef por key dentro del alcance del rol + capabilities.
export const getScreenDef = (role: RoleDef, key: string, features: Features = FEATURES, capabilities: string[] = []): ScreenDef => {
  const nav = getNav(role, features, capabilities)
  return nav.find((s) => s.key === key) ?? nav[0] ?? COMMON_SCREEN
}

// Quién puede gestionar la vista común (crear/editar anuncios/avisos/assets):
// Administración. El resto del staff la ve en modo lectura.
export const canManageHub = (key: RoleKey): boolean => key === 'admin'

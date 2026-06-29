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

export interface ScreenDef {
  key: string
  label: string
  icon: IconName
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
export const COMMON_SCREEN: ScreenDef = { key: 'comun', label: 'Vista común', icon: 'home' }
export const CHAT_SCREEN: ScreenDef = { key: 'chat', label: 'Chat', icon: 'chat' }
export const HUB_SCREENS: ScreenDef[] = [COMMON_SCREEN, CHAT_SCREEN]

export const ROLES: RoleDef[] = [
  {
    key: 'admin', label: 'Administración', group: 'Administración · Dirección',
    icon: 'dashboard', isStaff: true, ready: true,
    modules: [
      { key: 'bandeja', label: 'Mi bandeja', icon: 'check' },
      { key: 'tablero', label: 'Tablero', icon: 'dashboard' },
      { key: 'av_ventas', label: 'Ventas', icon: 'chart' },
      { key: 'av_prosp', label: 'Prospectos', icon: 'grid' },
      { key: 'av_inv', label: 'Inventario', icon: 'box' },
      { key: 'av_doc', label: 'Doctores', icon: 'usercheck' },
      { key: 'av_traza', label: 'Trazabilidad', icon: 'fingerprint' },
      { key: 'av_audit', label: 'Bitácora', icon: 'shield' },
      { key: 'seguimiento', label: 'Seguimiento', icon: 'truck' },
      { key: 'av_fin', label: 'Facturación', icon: 'receipt' },
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
      { key: 'bandeja', label: 'Mi bandeja', icon: 'check' },
      { key: 'stock', label: 'Existencias', icon: 'box' },
      { key: 'surtido', label: 'Surtido (FEFO)', icon: 'layers' },
      { key: 'caduc', label: 'Caducidades', icon: 'clock' },
      { key: 'entradas', label: 'Entradas', icon: 'download' },
      { key: 'compras', label: 'Compras', icon: 'cart' },
      { key: 'cola', label: 'Por empacar', icon: 'pkg' },
      { key: 'guia', label: 'Guías', icon: 'truck' },
      { key: 'recibo', label: 'Recibo de entrega', icon: 'receipt' },
      { key: 'seguimiento', label: 'Seguimiento', icon: 'truck' },
    ],
  },
  {
    key: 'pos', label: 'Punto de Venta', group: 'Punto de venta · Ventas',
    icon: 'store', isStaff: true, ready: true,
    modules: [
      { key: 'caja', label: 'Caja', icon: 'store' },
      { key: 'vev', label: 'Ventas del evento', icon: 'grid' },
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

export const getRole = (key: RoleKey): RoleDef =>
  ROLES.find((r) => r.key === key) ?? ROLES[0]

// Roles disponibles según los add-ons contratados (oculta comm/driver si no aplican).
export const availableRoles = (features: Features = FEATURES): RoleDef[] =>
  ROLES.filter((r) => !r.requiresFeature || features[r.requiresFeature])

// Navegación visible: staff = [vista común (si add-on), ...módulos]; doctor = módulos.
export const getNav = (role: RoleDef, features: Features = FEATURES): ScreenDef[] => {
  const nav: ScreenDef[] = []
  if (role.isStaff && features.comunicacionInterna) nav.push(...HUB_SCREENS)
  nav.push(...role.modules)
  return nav
}

// Pantalla de entrada tras "login": la primera de su navegación.
export const getEntryScreen = (role: RoleDef, features: Features = FEATURES): string =>
  getNav(role, features)[0]?.key ?? COMMON_SCREEN.key

// Resuelve un ScreenDef por key dentro del alcance del rol.
export const getScreenDef = (role: RoleDef, key: string, features: Features = FEATURES): ScreenDef => {
  const nav = getNav(role, features)
  return nav.find((s) => s.key === key) ?? nav[0] ?? COMMON_SCREEN
}

// Quién puede gestionar la vista común (crear/editar anuncios/avisos/assets):
// Administración. El resto del staff la ve en modo lectura.
export const canManageHub = (key: RoleKey): boolean => key === 'admin'

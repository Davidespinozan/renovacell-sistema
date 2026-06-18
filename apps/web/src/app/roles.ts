// Modelo del HUB (sistema de comunicación = contenedor de toda la plataforma).
//
// - El hub (sidebar/topbar) es el marco; el contenido cambia al módulo.
// - STAFF entra a la VISTA COMÚN (home interna) y navega a sus módulos permitidos.
// - DOCTOR entra directo a su Portal y NO ve la vista común (es contenido del equipo).
// - "Comunicación" como ROL es quien gestiona anuncios/avisos/assets (no es un módulo aparte).
import type { IconName } from './icons'

export type RoleKey =
  | 'admin' | 'doctor' | 'warehouse' | 'packing' | 'pos' | 'billing' | 'driver' | 'comm'

export interface ScreenDef {
  key: string
  label: string
  icon: IconName
}

export interface RoleDef {
  key: RoleKey
  label: string        // etiqueta corta para el switch
  group: string        // encabezado del grupo de módulos en el sidebar
  icon: IconName       // ícono del rol en el switch
  isStaff: boolean     // staff ve la vista común; el doctor no
  entry: string        // pantalla de entrada tras "login"
  modules: ScreenDef[] // módulos propios del rol (SIN la vista común)
  ready: boolean       // false = pendiente de spec (placeholder informativo)
}

// La VISTA COMÚN es el home del hub: la comparten todos los roles staff.
// No es un módulo de ningún rol; es el contenedor.
export const COMMON_SCREEN: ScreenDef = { key: 'comun', label: 'Vista común', icon: 'home' }

export const ROLES: RoleDef[] = [
  {
    key: 'admin',
    label: 'Administración',
    group: 'Administración · Dirección',
    icon: 'dashboard',
    isStaff: true,
    entry: COMMON_SCREEN.key,
    ready: true,
    modules: [
      { key: 'tablero', label: 'Tablero', icon: 'dashboard' },
      { key: 'av_ventas', label: 'Ventas', icon: 'chart' },
      { key: 'av_prosp', label: 'Prospectos', icon: 'grid' },
      { key: 'av_inv', label: 'Inventario', icon: 'box' },
      { key: 'av_doc', label: 'Doctores', icon: 'usercheck' },
      { key: 'av_traza', label: 'Trazabilidad', icon: 'fingerprint' },
      { key: 'av_fin', label: 'Facturación', icon: 'receipt' },
    ],
  },
  {
    key: 'doctor',
    label: 'Portal del Doctor',
    group: 'Portal del Doctor',
    icon: 'bag',
    isStaff: false,            // NO ve la vista común
    entry: 'catalogo',         // entra directo a su portal
    ready: true,
    modules: [
      { key: 'catalogo', label: 'Catálogo', icon: 'grid' },
      { key: 'pedidosdr', label: 'Mis pedidos', icon: 'bag' },
      { key: 'hist', label: 'Historial', icon: 'clock' },
      { key: 'asist', label: 'Asistente IA', icon: 'chat' },
    ],
  },
  {
    key: 'warehouse',
    label: 'Almacén',
    group: 'Almacén',
    icon: 'box',
    isStaff: true,
    entry: COMMON_SCREEN.key,
    ready: true,
    modules: [
      { key: 'stock', label: 'Existencias', icon: 'box' },
      { key: 'surtido', label: 'Surtido (FEFO)', icon: 'layers' },
      { key: 'caduc', label: 'Caducidades', icon: 'clock' },
      { key: 'entradas', label: 'Entradas', icon: 'download' },
    ],
  },
  {
    key: 'packing',
    label: 'Empaque',
    group: 'Empaque',
    icon: 'pkg',
    isStaff: true,
    entry: COMMON_SCREEN.key,
    ready: true,
    modules: [
      { key: 'cola', label: 'Por empacar', icon: 'pkg' },
      { key: 'guia', label: 'Guías', icon: 'truck' },
      { key: 'recibo', label: 'Recibo de entrega', icon: 'receipt' },
    ],
  },
  {
    key: 'pos',
    label: 'Punto de Venta',
    group: 'Punto de venta · Ventas',
    icon: 'store',
    isStaff: true,
    entry: COMMON_SCREEN.key,
    ready: true,
    modules: [
      { key: 'caja', label: 'Caja', icon: 'store' },
      { key: 'vev', label: 'Ventas del evento', icon: 'grid' },
    ],
  },
  {
    key: 'billing',
    label: 'Facturación',
    group: 'Facturación · Finanzas',
    icon: 'receipt',
    isStaff: true,
    entry: COMMON_SCREEN.key,
    ready: true,
    modules: [
      { key: 'fin', label: 'Facturación', icon: 'receipt' },
    ],
  },
  {
    key: 'driver',
    label: 'Chofer',
    group: 'Chofer · Entregas',
    icon: 'truck',
    isStaff: true,
    entry: COMMON_SCREEN.key,
    ready: false, // pendiente de spec
    modules: [
      { key: 'driver_home', label: 'Chofer / Seguimiento', icon: 'truck' },
    ],
  },
  {
    key: 'comm',
    label: 'Comunicación',
    group: 'Comunicación interna',
    icon: 'megaphone',
    isStaff: true,
    entry: COMMON_SCREEN.key,
    ready: true,
    // Su "módulo" ES la vista común (la gestiona). No tiene módulos extra.
    modules: [],
  },
]

export const getRole = (key: RoleKey): RoleDef =>
  ROLES.find((r) => r.key === key) ?? ROLES[0]

// Navegación visible para un rol: staff = [vista común, ...módulos]; doctor = módulos.
export const getNav = (role: RoleDef): ScreenDef[] =>
  role.isStaff ? [COMMON_SCREEN, ...role.modules] : role.modules

// Resuelve un ScreenDef por key dentro del alcance del rol (incluye la vista común).
export const getScreenDef = (role: RoleDef, key: string): ScreenDef =>
  getNav(role).find((s) => s.key === key) ?? getNav(role)[0]

// Roles staff con permiso de gestión de la vista común (crear/editar).
export const canManageHub = (key: RoleKey): boolean => key === 'admin' || key === 'comm'

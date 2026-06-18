// Configuración de roles y su navegación (las "puertas" del sistema).
// Mapea cada rol -> sus pantallas, según el prototipo del demo.
// Los `key` de pantalla se conservan del demo para trazabilidad.
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
  group: string        // encabezado del grupo en el sidebar
  icon: IconName       // ícono del rol en el switch
  defScreen: string    // pantalla por defecto
  screens: ScreenDef[]
  ready: boolean       // false = pendiente de spec (placeholder informativo)
}

export const ROLES: RoleDef[] = [
  {
    key: 'admin',
    label: 'Administración',
    group: 'Administración · Dirección',
    icon: 'dashboard',
    defScreen: 'tablero',
    ready: true,
    screens: [
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
    defScreen: 'catalogo',
    ready: true,
    screens: [
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
    defScreen: 'stock',
    ready: true,
    screens: [
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
    defScreen: 'cola',
    ready: true,
    screens: [
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
    defScreen: 'caja',
    ready: true,
    screens: [
      { key: 'caja', label: 'Caja', icon: 'store' },
      { key: 'vev', label: 'Ventas del evento', icon: 'grid' },
    ],
  },
  {
    key: 'billing',
    label: 'Facturación',
    group: 'Facturación · Finanzas',
    icon: 'receipt',
    defScreen: 'fin',
    ready: true,
    screens: [
      { key: 'fin', label: 'Facturación', icon: 'receipt' },
    ],
  },
  {
    key: 'driver',
    label: 'Chofer',
    group: 'Chofer · Entregas',
    icon: 'truck',
    defScreen: 'driver_home',
    ready: false, // pendiente de spec (el usuario la pasa después)
    screens: [
      { key: 'driver_home', label: 'Entregas del día', icon: 'truck' },
    ],
  },
  {
    key: 'comm',
    label: 'Comunicación',
    group: 'Comunicación interna',
    icon: 'chat',
    defScreen: 'comm_home',
    ready: false, // pendiente de spec
    screens: [
      { key: 'comm_home', label: 'Anuncios', icon: 'bell' },
      { key: 'comm_assets', label: 'Biblioteca', icon: 'image' },
    ],
  },
]

export const getRole = (key: RoleKey): RoleDef =>
  ROLES.find((r) => r.key === key) ?? ROLES[0]

export const getScreen = (role: RoleDef, key: string): ScreenDef =>
  role.screens.find((s) => s.key === key) ?? role.screens[0]

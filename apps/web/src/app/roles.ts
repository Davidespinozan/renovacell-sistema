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
  | 'admin' | 'doctor' | 'warehouse' | 'packing' | 'pos' | 'driver'

// Responsabilidades que Administración suma a un usuario sobre su rol base.
export type CapabilityKey = 'diseno' | 'eventos' | 'anuncios' | 'contenido' | 'conversaciones' | 'nuevos_clientes' | 'jefe_ventas'

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
      // REORG CRM (15 oct 2026, decisión del dueño): secciones por intención. Clientes (quién compra), Conversaciones
      // (todo lo que entra por chat/WhatsApp/enlace y lo que se le escribe al cliente), Catálogo y web, Operación,
      // Finanzas, Equipo (personas y su atención) y Sistema. "Prospectos" (CRM de maquetas, vacío en prod) se retiró:
      // los leads reales viven en Conversaciones.
      // MENÚ AGRUPADO (dueño, 17 oct 2026): 31 entradas → 14. Inicio ES la bandeja; cada grupo abre una pantalla con pestañas
      // internas (registry g_*) que renderizan las pantallas de siempre. Clientes y Ventas NO van juntas (decisión del dueño).
      { key: 'tablero', label: 'Tablero', icon: 'dashboard', section: 'Mi trabajo' },
      { key: 'av_ventas', label: 'Ventas', icon: 'chart', section: 'Mi trabajo' },
      { key: 'g_clientes', label: 'Clientes', icon: 'usercheck', section: 'Clientes' },          // Clientes · Por verificar · Invitar
      { key: 'g_conversaciones', label: 'Conversaciones', icon: 'chat', section: 'Conversaciones' },   // Bandeja · Asignadas · Correos
      { key: 'g_catalogo', label: 'Catálogo', icon: 'bag', section: 'Catálogo y web' },           // Productos · Precios · Conocimiento
      { key: 'av_sitio', label: 'Sitio web', icon: 'image', section: 'Catálogo y web' },
      { key: 'av_inv', label: 'Compras a proveedores', icon: 'cart', section: 'Operación' },
      { key: 'g_inventario', label: 'Control de inventario', icon: 'box', section: 'Operación' },   // Trazabilidad · Mermas · Control · Custodias ("Inventario" a secas = existencias, decisión 13 oct)
      { key: 'g_envios', label: 'Envíos', icon: 'truck', section: 'Operación' },                 // Despacho · Seguimiento
      { key: 'g_finanzas', label: 'Finanzas', icon: 'dashboard', section: 'Finanzas' },          // Finanzas · Cierre de caja
      { key: 'g_cobros', label: 'Cobros', icon: 'receipt', section: 'Finanzas' },                // Pagos por validar · Revisión económica
      { key: 'g_facturacion', label: 'Facturación', icon: 'receipt', section: 'Finanzas' },      // Facturación · Revisión fiscal
      { key: 'g_equipo', label: 'Equipo', icon: 'usercheck', section: 'Equipo' },                // Personas · Cartera y horario · Metas
      { key: 'g_sistema', label: 'Configuración', icon: 'store', section: 'Sistema' },           // Configuración · Bitácora
    ],
  },
  {
    key: 'doctor', label: 'Portal del Doctor', group: 'Portal del Doctor',
    icon: 'bag', isStaff: false, ready: true,
    modules: [
      { key: 'catalogo', label: 'Catálogo', icon: 'grid' },
      { key: 'g_pedidosdr', label: 'Mis pedidos', icon: 'bag' },   // MENÚ (dueño, 17 oct 2026): En curso · Historial en una entrada
      // UX-1 · UNA sola conversación con Renovacell (IA + asesor humano en el mismo hilo). El antiguo
      // 'asist' (Asistente IA) ya no es módulo: su clave sigue resolviendo a esta pantalla (alias).
      { key: 'chat_cc', label: 'Habla con Renovacell', icon: 'chat' },
      { key: 'mi_verificacion', label: 'Mi verificación', icon: 'shield' },   // cuenta ≠ verificación
    ],
  },
  {
    // Almacén y Empaque los ve la MISMA persona (Alberto) → un solo rol.
    key: 'warehouse', label: 'Almacén / Empaque', group: 'Almacén y Empaque · Alberto',
    icon: 'box', isStaff: true, ready: true,
    modules: [
      // ALM-1 · Inicio ES la pantalla del día (Hoy + Mi bandeja en una); por eso aquí no hay 'bandeja' ni 'hoy'.
      // Orden = el recorrido real. Almacén: lo que hay y lo que entra. Pedidos y envíos: surtir → enviar → guía → salida → rastreo.
      // La remisión del paquete no es una pantalla: se imprime desde "Por enviar" y desde "Guías".
      // El menú cuenta la historia del inventario (dueño, 15 oct 2026): lo que HAY (Inventario, Por caducar) y lo que
      // ENTRA (una compra se pide en Compras a proveedores y se vuelve inventario al Recibir mercancía).
      { key: 'stock', label: 'Inventario', icon: 'box', section: 'Inventario' },
      { key: 'caduc', label: 'Por caducar', icon: 'clock', section: 'Inventario' },
      { key: 'compras', label: 'Compras a proveedores', icon: 'cart', section: 'Compras y entradas' },   // solo lectura para Almacén: qué viene en camino
      { key: 'entradas', label: 'Recibir mercancía', icon: 'download', section: 'Compras y entradas' },   // UX-2 · aquí nace el inventario
      { key: 'devoluciones', label: 'Devoluciones', icon: 'box', section: 'Compras y entradas' },
      { key: 'consigna_alm', label: 'Custodia', icon: 'box', section: 'Compras y entradas' },
      { key: 'surtido', label: 'Preparar pedidos', icon: 'layers', section: 'Pedidos y envíos' },
      { key: 'cola', label: 'Por enviar', icon: 'pkg', section: 'Pedidos y envíos' },
      { key: 'guia', label: 'Guías', icon: 'truck', section: 'Pedidos y envíos' },
      { key: 'despacho', label: 'Despacho', icon: 'truck', section: 'Pedidos y envíos' },
      { key: 'seguimiento', label: 'Seguimiento', icon: 'truck', section: 'Pedidos y envíos' },
      { key: 'agenda_entregas', label: 'Horarios de entrega', icon: 'clock', section: 'Pedidos y envíos' },   // ENT-H · agenda de entregas locales por horario
    ],
  },
  {
    // AUXILIAR DE ALMACÉN (rol 'packing', dueño 28 oct 2026): "Blanca es la asistente de Alberto; ella en sí se encarga de
    // empaque y despacho" y del inventario físico (ver existencias y corregir el conteo). Recibir mercancía, compras,
    // devoluciones, custodia, guías y seguimiento son de Alberto (inventario y control digital); el servidor se los niega.
    key: 'packing', label: 'Auxiliar de almacén', group: 'Empaque y despacho',
    icon: 'pkg', isStaff: true, ready: true,
    modules: [
      { key: 'stock', label: 'Inventario', icon: 'box', section: 'Inventario' },
      { key: 'caduc', label: 'Por caducar', icon: 'clock', section: 'Inventario' },
      { key: 'surtido', label: 'Preparar pedidos', icon: 'layers', section: 'Pedidos y envíos' },
      { key: 'cola', label: 'Por enviar', icon: 'pkg', section: 'Pedidos y envíos' },
      { key: 'despacho', label: 'Despacho', icon: 'truck', section: 'Pedidos y envíos' },
      { key: 'agenda_entregas', label: 'Horarios de entrega', icon: 'clock', section: 'Pedidos y envíos' },
    ],
  },
  {
    // Vendedor de campo: cada quien ve SOLO su cartera (aislado por vendedor).
    key: 'pos', label: 'Ventas', group: 'Ventas · Campo',
    icon: 'bag', isStaff: true, ready: true,
    modules: [
      // MENÚ (dueño, 17 oct 2026): Inicio ES la bandeja y el seguimiento de su cartera; menos pestañas.
      { key: 'caja', label: 'Punto de venta', icon: 'store', section: 'Vender' },
      { key: 'clientes', label: 'Clientes', icon: 'usercheck', section: 'Mi cartera' },
      { key: 'consigna', label: 'Mi inventario', icon: 'box', section: 'Mi cartera' },
    ],
  },
  {
    key: 'driver', label: 'Chofer', group: 'Chofer · Entregas',
    icon: 'truck', isStaff: true, ready: true, requiresFeature: 'chofer',
    modules: [
      { key: 'driver_home', label: 'Chofer / Seguimiento', icon: 'truck' },
      { key: 'agenda_entregas', label: 'Horarios de entrega', icon: 'clock' },   // ENT-H · el chofer ve a qué hora se prometió cada entrega local
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
  // Jefe de ventas: ve Metas y comisiones de TODO el equipo (lectura; metas y tasas las define Dirección). El servidor
  // exige esta capacidad (comisiones_equipo).
  { key: 'jefe_ventas', label: 'Jefe de ventas', modules: [{ key: 'av_comisiones', label: 'Metas y comisiones', icon: 'chart', section: 'Mi cartera' }] },
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

// ── MENÚ AGRUPADO (dueño, 17 oct 2026) ─────────────────────────────────────────────────────────────────
// Varias pantallas viven dentro de UNA entrada del menú con pestañas internas (registry g_*). Las claves sueltas
// siguen existiendo (avisos, tareas, búsqueda y enlaces profundos las usan): `resolverDestino` las traduce al grupo y
// deja pedida la pestaña. Lo que ya no tiene entrada propia (bandeja, seguimiento del vendedor, hoy de Almacén) cae en Inicio.
export const SUBPANTALLAS: Record<string, Array<{ key: string; label: string }>> = {
  g_clientes: [{ key: 'av_doc', label: 'Clientes' }, { key: 'av_verif', label: 'Por verificar' }, { key: 'av_invitar', label: 'Invitar clientes' }],
  g_conversaciones: [{ key: 'av_atencion', label: 'Bandeja' }, { key: 'asesorias', label: 'Asignadas' }, { key: 'av_mensajes', label: 'Correos al cliente' }],
  g_catalogo: [{ key: 'av_catalogo', label: 'Productos' }, { key: 'av_precios', label: 'Precios' }, { key: 'av_promociones', label: 'Promociones' }, { key: 'av_conocimiento', label: 'Conocimiento de producto' }, { key: 'av_manual_ventas', label: 'Manual de ventas' }],
  g_inventario: [{ key: 'av_existencias', label: 'Existencias' }, { key: 'av_entradas', label: 'Entradas' }, { key: 'av_traza', label: 'Trazabilidad' }, { key: 'av_mermas', label: 'Mermas' }, { key: 'av_control_inv', label: 'Control de inventario' }, { key: 'av_custodias', label: 'Custodias' }],
  g_envios: [{ key: 'despacho', label: 'Despacho' }, { key: 'seguimiento', label: 'Seguimiento' }],
  g_finanzas: [{ key: 'av_finanzas', label: 'Finanzas' }, { key: 'av_cierre', label: 'Cierre de caja' }],
  g_cobros: [{ key: 'av_pagos', label: 'Pagos por validar' }, { key: 'av_revision', label: 'Revisión económica' }],
  g_facturacion: [{ key: 'av_fin', label: 'Facturación' }, { key: 'av_fiscal', label: 'Revisión fiscal' }],
  g_equipo: [{ key: 'av_equipo', label: 'Personas' }, { key: 'av_cartera', label: 'Cartera y horario' }, { key: 'av_comisiones', label: 'Metas y comisiones' }],
  g_sistema: [{ key: 'av_config', label: 'Configuración' }, { key: 'av_audit', label: 'Bitácora' }],
  g_pedidosdr: [{ key: 'pedidosdr', label: 'En curso' }, { key: 'hist', label: 'Historial' }],   // portal del doctor
}
export const GRUPOS: Record<string, string[]> = Object.fromEntries(Object.entries(SUBPANTALLAS).map(([g, xs]) => [g, xs.map((x) => x.key)]))
export const GRUPO_DE: Record<string, string> = Object.fromEntries(Object.entries(GRUPOS).flatMap(([g, ks]) => ks.map((k) => [k, g])))
const ALIAS_INICIO: ReadonlySet<string> = new Set(['bandeja', 'alm_hoy', 'seguimiento'])
/** Claves que el rol puede abrir: las del menú más las pestañas de los grupos que tiene en el menú. */
export function pantallasAlcanzables(nav: ScreenDef[]): Set<string> {
  const s = new Set(nav.map((x) => x.key))
  for (const x of nav) for (const k of GRUPOS[x.key] ?? []) s.add(k)
  return s
}
/** A qué pantalla ir cuando se pide `key`: ella misma, su grupo (con la pestaña pedida) o Inicio si ya no tiene entrada. */
export function resolverDestino(nav: ScreenDef[], key: string): { screen: string; pestana?: string } {
  if (nav.some((x) => x.key === key)) return { screen: key }
  const g = GRUPO_DE[key]
  if (g && nav.some((x) => x.key === g)) return { screen: g, pestana: key }
  if (ALIAS_INICIO.has(key) && nav.some((x) => x.key === INICIO_SCREEN.key)) return { screen: INICIO_SCREEN.key }
  return { screen: key }
}

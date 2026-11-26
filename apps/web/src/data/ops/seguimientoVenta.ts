// SEGUIMIENTO DE ENTREGA EN VENTAS DEL EQUIPO (26 nov 2026, Roberto: «cuándo lo entrega el repartidor y cuándo le dan
// salida a los productos de almacén»). Lo arma el servidor (ventas_equipo → seguimiento); aquí solo se presenta.
import { ZONA_NEGOCIO } from '../periodo'

export interface SeguimientoVenta {
  empacado_at?: string | null; salio_at?: string | null; entregado_at?: string | null; carga_recibida_at?: string | null
  despacho_por?: string | null; chofer?: string | null; recibio?: string | null; con_foto?: boolean
  guia?: string | null; paqueteria?: string | null; incidente?: string | null
}
export type EtapaSeguimiento = 'entregado' | 'salio' | 'empacado' | 'almacen' | 'cancelado'

export const seguimientoDe = (o: unknown): SeguimientoVenta | null => {
  const s = (o as { seguimiento?: unknown } | null)?.seguimiento
  return s && typeof s === 'object' ? (s as SeguimientoVenta) : null
}

/** «24 nov, 4:35 p.m.» en la hora del negocio. */
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: ZONA_NEGOCIO })}, ${d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: ZONA_NEGOCIO })}`
}

/** Dónde va el pedido en el almacén → calle, con la hora del último paso. */
export function etapaSeguimiento(o: { status?: string | null; seguimiento?: unknown }): { etapa: EtapaSeguimiento; texto: string; pill: string } {
  const s = seguimientoDe(o) ?? {}
  if (o.status === 'cancelled') return { etapa: 'cancelado', texto: 'Cancelado', pill: 'p-neu' }
  if (s.entregado_at || o.status === 'delivered') return { etapa: 'entregado', texto: s.entregado_at ? `Entregado ${fechaHora(s.entregado_at)}` : 'Entregado', pill: 'p-ok' }
  if (s.salio_at || o.status === 'shipped') return { etapa: 'salio', texto: s.salio_at ? `Salió ${fechaHora(s.salio_at)}` : 'Salió del almacén', pill: 'p-blue' }
  if (s.empacado_at || o.status === 'packed') return { etapa: 'empacado', texto: s.empacado_at ? `Empacado ${fechaHora(s.empacado_at)}` : 'Empacado', pill: 'p-warn' }
  return { etapa: 'almacen', texto: 'Aún en almacén', pill: 'p-neu' }
}

// SEGUIMIENTO · POR DÓNDE VIAJA Y EN QUÉ VA (27 nov 2026, dueño: «¿por qué en Envíos nada más se pueden ver las
// entregas locales en Dirección? ¿no tienen manera de ver trazabilidad de envíos foráneos?»).
//
// La pantalla solo listaba pedidos YA preparados. Los foráneos pagados que seguían en Almacén sin guía no aparecían, y
// como en producción ninguno tenía guía registrada, Dirección veía únicamente las entregas del chofer. Aquí vive lo que
// se puede probar sin pantalla: por dónde viaja un pedido (paquetería, chofer o lo recogen), en qué etapa va y el
// diagnóstico de los que TODAVÍA no salen de Almacén. Nada se inventa: todo sale de lo prometido al vender y del envío.
import type { Shipment } from '../types'
import type { OrderWithItems } from '../store/ordersStore'
import { NOMBRE_PAQUETERIA, entregaDelPedido, grupoDeSalida } from './entrega'
import { esRecoge, type Diagnosis } from './seguimiento'

export type MedioEnvio = 'paqueteria' | 'chofer' | 'recoge'
export type EtapaEnvio = 'por_preparar' | 'preparado' | 'en_camino' | 'entregado'

export const ETIQUETA_MEDIO: Record<MedioEnvio, string> = { paqueteria: 'Paquetería', chofer: 'Chofer local', recoge: 'Lo recogen' }
export const ETIQUETA_ETAPA: Record<EtapaEnvio, string> = { por_preparar: 'Por preparar', preparado: 'Preparados sin salir', en_camino: 'En camino', entregado: 'Entregados' }
export const MEDIOS: MedioEnvio[] = ['paqueteria', 'chofer', 'recoge']
export const ETAPAS: EtapaEnvio[] = ['por_preparar', 'preparado', 'en_camino', 'entregado']

/** Por dónde viaja: manda el envío que ya existe (la realidad); si aún no hay, lo que se prometió al vender. */
export function medioDe(order: Pick<OrderWithItems, 'shipping_meta'>, shipment: Pick<Shipment, 'driver_id'> | null | undefined): MedioEnvio | null {
  const e = entregaDelPedido(order.shipping_meta)
  if (esRecoge(order) || e?.tipo === 'recoge' || e?.tipo === 'mostrador') return 'recoge'
  if (shipment) return shipment.driver_id ? 'chofer' : 'paqueteria'
  if (e?.tipo === 'foraneo') return 'paqueteria'
  if (e?.tipo === 'local') return 'chofer'
  return null
}

/** En qué va, leído del pedido: sin preparar, preparado sin salir, en camino (o listo para recoger) o entregado. */
export function etapaDe(order: Pick<OrderWithItems, 'status'>): EtapaEnvio {
  if (order.status === 'delivered' || order.status === 'fulfilled') return 'entregado'
  if (order.status === 'shipped') return 'en_camino'
  if (order.status === 'packed') return 'preparado'
  return 'por_preparar'
}

/** ¿Ya le toca a Almacén y sigue sin prepararse? Liberado (pagado o con crédito) y sin preparar, enviar ni cancelar. */
export function esperaEnAlmacen(order: Pick<OrderWithItems, 'status' | 'payment_status'>, dinero?: { liberado: boolean } | null): boolean {
  return (dinero ? dinero.liberado : order.payment_status === 'paid') && !['packed', 'shipped', 'delivered', 'fulfilled', 'cancelled'].includes(order.status ?? '')
}

/** Cómo viaja un pedido que aún no tiene envío: «DHL · sin guía todavía», «Chofer · sin asignar», «Lo recogen en sucursal». */
export function metodoPrometido(order: Pick<OrderWithItems, 'shipping_meta'>): string {
  const e = entregaDelPedido(order.shipping_meta)
  if (esRecoge(order) || e?.tipo === 'recoge') return 'Recoge en sucursal'
  if (e?.tipo === 'mostrador') return 'Entrega en mostrador'
  if (e?.tipo === 'foraneo') return `${e.paqueteria ? (NOMBRE_PAQUETERIA[e.paqueteria] ?? e.paqueteria.toUpperCase()) : 'Paquetería'} · sin guía todavía`
  if (e?.tipo === 'local') return 'Chofer · sin asignar'
  return 'Sin asignar'
}

/** Diagnóstico de un pedido que sigue en Almacén sin preparar: cuándo sale, o desde cuándo debió salir (detenido). */
export function diagnosticoEnAlmacen(order: Pick<OrderWithItems, 'shipping_meta'>, hoy: string, corte?: string): Diagnosis & { salida: string | null } {
  const e = entregaDelPedido(order.shipping_meta)
  const g = grupoDeSalida(e, hoy, corte)
  const sinHora = g.titulo.replace(/ antes de las [^·]+/, ' ').replace(/\s+/g, ' ').trim()
  if (g.cuando === 'atrasado') return { stuck: true, reason: `Sigue en Almacén sin preparar · ${sinHora.charAt(0).toLowerCase()}${sinHora.slice(1)}`, statusLabel: 'Por preparar', statusPill: 'p-warn', salida: sinHora }
  return { stuck: false, reason: '', statusLabel: 'Por preparar', statusPill: 'p-warn', salida: g.cuando === 'sin' ? null : g.titulo }
}

/** Cuántos hay por medio y, dentro del medio elegido, por etapa (para las fichas de filtro). */
export function contar<T extends { medio: MedioEnvio | null; etapa: EtapaEnvio }>(filas: T[], medio: MedioEnvio | 'todos'): { porMedio: Record<MedioEnvio, number>; porEtapa: Record<EtapaEnvio, number>; total: number } {
  const porMedio: Record<MedioEnvio, number> = { paqueteria: 0, chofer: 0, recoge: 0 }
  const porEtapa: Record<EtapaEnvio, number> = { por_preparar: 0, preparado: 0, en_camino: 0, entregado: 0 }
  for (const f of filas) {
    if (f.medio) porMedio[f.medio] += 1
    if (medio === 'todos' || f.medio === medio) porEtapa[f.etapa] += 1
  }
  return { porMedio, porEtapa, total: filas.length }
}

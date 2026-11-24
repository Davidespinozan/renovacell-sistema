// ENVÍOS EXTRA (24 nov 2026) · un pedido con 2 o más envíos foráneos. La vendedora reparte al vender qué va a cada domicilio;
// cada extra cuesta $600 (entrega_config.envio_extra_costo, lo cobra el servidor). Almacén genera una guía por PAQUETE:
// 0 = el principal (todo lo de siempre), 1..n = los extras (shipping_meta.entrega.extras). Aquí solo lectura y armado.
import type { Shipment } from '../types'
import type { OrderWithItems } from '../store/ordersStore'
import type { ShippingAddress } from './shippingAddress'

export const COSTO_ENVIO_EXTRA = 600   // solo para mostrar antes de crear; el servidor cobra el de Configuración
export const MAX_ENVIOS_EXTRA = 5

export interface LineaExtra { product_id: string; qty: number; nombre?: string | null }
/** PAQUETERÍA POR ENVÍO · con qué paquetería va cada envío extra (la elige la vendedora; Almacén la ve preseleccionada). */
export type PaqueteriaExtra = 'dhl' | 'estafeta' | 'etn' | 'tus' | 'tns'
export const PAQUETERIAS_EXTRA: Array<{ id: PaqueteriaExtra; nombre: string }> = [
  { id: 'dhl', nombre: 'DHL' }, { id: 'estafeta', nombre: 'Estafeta' }, { id: 'etn', nombre: 'ETN' },
  { id: 'tus', nombre: 'Unidos de Sinaloa' }, { id: 'tns', nombre: 'Norte de Sinaloa' },
]
export const esPaqueteriaExtra = (x: unknown): x is PaqueteriaExtra => PAQUETERIAS_EXTRA.some((p) => p.id === x)
export const nombrePaqueteriaExtra = (x: string | null | undefined): string | null => PAQUETERIAS_EXTRA.find((p) => p.id === x)?.nombre ?? null

export interface EnvioExtra { paquete: number; address: ShippingAddress & { cp?: string; state?: string; colonia?: string; refs?: string }; contacto?: string | null; lineas: LineaExtra[]; flete: number; paqueteria?: PaqueteriaExtra | null }
/** Lo que la vendedora captura (antes de crear el pedido). */
export interface EnvioExtraBorrador { address: EnvioExtra['address'] | null; lineas: Record<string, number>; paqueteria?: PaqueteriaExtra | null }

export function extrasDe(o: Pick<OrderWithItems, 'shipping_meta'>): EnvioExtra[] {
  const e = (o.shipping_meta as { entrega?: { extras?: unknown } } | null)?.entrega?.extras
  return Array.isArray(e) ? (e as EnvioExtra[]).filter((x) => x && typeof x.paquete === 'number') : []
}

/** El envío vigente de un paquete (el más reciente no cancelado; si todos se cancelaron, ninguno). */
export function envioDePaquete(shipments: Shipment[], orderId: string, paquete: number): Shipment | undefined {
  return shipments.filter((s) => s.order_id === orderId && (s.paquete ?? 0) === paquete && s.status !== 'cancelado')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
}

/** Extras que todavía no tienen guía. */
export function extrasSinGuia(o: OrderWithItems, shipments: Shipment[]): EnvioExtra[] {
  return extrasDe(o).filter((x) => !envioDePaquete(shipments, o.id, x.paquete))
}

/** El pedido visto desde un paquete extra: mismo id, pero el domicilio (y quien recibe) del extra y SU paquetería
 *  (si la vendedora la eligió; si no, queda la del principal). Para la guía. */
export function pedidoDePaquete(o: OrderWithItems, x: EnvioExtra): OrderWithItems {
  const meta = (o.shipping_meta ?? {}) as Record<string, unknown> & { customer?: { name?: string; phone?: string | null } | null; entrega?: Record<string, unknown> | null }
  const paq = esPaqueteriaExtra(x.paqueteria) && meta.entrega ? { entrega: { ...meta.entrega, paqueteria: x.paqueteria } } : {}
  return { ...o, shipping_meta: { ...meta, ...paq, address: x.address, customer: { ...(meta.customer ?? {}), name: x.contacto || meta.customer?.name || '', phone: x.address.phone ?? meta.customer?.phone ?? null } } as OrderWithItems['shipping_meta'] }
}

export const lugarDe = (a: EnvioExtra['address'] | null | undefined): string =>
  !a ? '' : [a.city, a.state].filter(Boolean).join(', ') || a.line1 || ''

/** Piezas que quedan para el envío principal después de repartir los extras (por producto). */
export function restoPrincipal(cart: Record<string, number>, extras: EnvioExtraBorrador[]): Record<string, number> {
  const r: Record<string, number> = { ...cart }
  for (const x of extras) for (const [id, n] of Object.entries(x.lineas)) r[id] = (r[id] ?? 0) - (n || 0)
  return r
}

/** Qué le falta a lo capturado para poder crear el pedido; null si está completo. */
export function faltaEnExtras(cart: Record<string, number>, extras: EnvioExtraBorrador[], esLocal: (cp: string) => boolean): string | null {
  for (let i = 0; i < extras.length; i++) {
    const x = extras[i]; const n = i + 1
    if (!x.address || !x.address.line1 || !/^\d{5}$/.test(String(x.address.cp ?? ''))) return `Envío extra ${n}: elige un domicilio con calle y código postal.`
    if (esLocal(String(x.address.cp))) return `Envío extra ${n}: es a Culiacán; los envíos extra son solo foráneos.`
    if (!esPaqueteriaExtra(x.paqueteria)) return `Envío extra ${n}: elige con qué paquetería va.`
    if (!Object.values(x.lineas).some((q) => q > 0)) return `Envío extra ${n}: indica qué productos van ahí.`
  }
  const resto = restoPrincipal(cart, extras)
  if (Object.values(resto).some((q) => q < 0)) return 'Repartiste más piezas de las que lleva el pedido.'
  if (extras.length && !Object.values(resto).some((q) => q > 0)) return 'Deja al menos un producto en el envío principal.'
  return null
}

/** Lo que viaja al servidor en p_entrega.extras. */
export function extrasParaServidor(extras: EnvioExtraBorrador[]): Array<{ address: EnvioExtra['address']; lineas: LineaExtra[]; paqueteria?: PaqueteriaExtra }> {
  return extras.map((x) => ({ address: x.address!, lineas: Object.entries(x.lineas).filter(([, q]) => q > 0).map(([product_id, qty]) => ({ product_id, qty })), ...(esPaqueteriaExtra(x.paqueteria) ? { paqueteria: x.paqueteria } : {}) }))
}

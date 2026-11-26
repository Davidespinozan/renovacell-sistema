// SEGUIMIENTO DE ENTREGA EN VENTAS DEL EQUIPO (26 nov 2026, Roberto: «cuándo lo entrega el repartidor y cuándo le dan
// salida a los productos de almacén»). Lo arma el servidor (ventas_equipo → seguimiento); aquí solo se presenta.
import { ZONA_NEGOCIO } from '../periodo'

export interface SeguimientoVenta {
  empacado_at?: string | null; salio_at?: string | null; entregado_at?: string | null; carga_recibida_at?: string | null
  despacho_por?: string | null; chofer?: string | null; recibio?: string | null; con_foto?: boolean
  guia?: string | null; paqueteria?: string | null; incidente?: string | null
}
export type EtapaSeguimiento = 'entregado' | 'salio' | 'empacado' | 'almacen' | 'por_confirmar' | 'esperando_mercancia' | 'cancelado'

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
export function etapaSeguimiento(o: { status?: string | null; payment_method?: string | null; shipping_meta?: unknown; seguimiento?: unknown }): { etapa: EtapaSeguimiento; texto: string; pill: string } {
  const s = seguimientoDe(o) ?? {}
  if (o.status === 'cancelled') return { etapa: 'cancelado', texto: 'Cancelado', pill: 'p-neu' }
  if (s.entregado_at || o.status === 'delivered') return { etapa: 'entregado', texto: s.entregado_at ? `Entregado ${fechaHora(s.entregado_at)}` : 'Entregado', pill: 'p-ok' }
  if (s.salio_at || o.status === 'shipped') return { etapa: 'salio', texto: s.salio_at ? `Salió ${fechaHora(s.salio_at)}` : 'Salió del almacén', pill: 'p-blue' }
  if (s.empacado_at || o.status === 'packed') return { etapa: 'empacado', texto: s.empacado_at ? `Empacado ${fechaHora(s.empacado_at)}` : 'Empacado', pill: 'p-warn' }
  // SOBRE PEDIDO (26 nov 2026): vendido sin existencia; no se surte ni se factura hasta que llegue la mercancía.
  if ((((o.shipping_meta as { sobre_pedido?: unknown[] } | null)?.sobre_pedido) ?? []).length > 0 && (o.status === 'paid' || o.status === 'pending_payment'))
    return { etapa: 'esperando_mercancia', texto: 'Esperando mercancía (sobre pedido)', pill: 'p-warn' }
  // POR CONFIRMAR · sin pago (ni crédito / paga al recibir) no llega a Almacén: no está «en almacén», espera el pago.
  if (o.status === 'pending_payment' && !['contra_entrega', 'credito'].includes(o.payment_method ?? '')) return { etapa: 'por_confirmar', texto: 'Por confirmar (falta el pago)', pill: 'p-warn' }
  return { etapa: 'almacen', texto: 'Aún en almacén', pill: 'p-neu' }
}

// TRAZABILIDAD PARA TODOS (26 nov 2026, dueño): Dirección y vendedoras leen el seguimiento de los pedidos que ven.
import { useEffect, useState } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>

export async function leerSeguimiento(ids: string[]): Promise<Record<string, SeguimientoVenta>> {
  if (!hasSupabase || ids.length === 0) return {}
  const out: Record<string, SeguimientoVenta> = {}
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await (supabase.rpc as unknown as Rpc)('seguimiento_ventas', { p_ids: ids.slice(i, i + 500) })
    if (!error && data && typeof data === 'object') Object.assign(out, data as Record<string, SeguimientoVenta>)
  }
  return out
}

/** Seguimiento por pedido (se recarga cada 2 minutos y cuando cambia la lista). */
export function useSeguimiento(ids: string[], activo = true): Record<string, SeguimientoVenta> {
  const [seg, setSeg] = useState<Record<string, SeguimientoVenta>>({})
  const clave = activo ? ids.slice().sort().join(',') : ''
  useEffect(() => {
    if (!clave) return
    let vivo = true
    const cargar = () => { void leerSeguimiento(clave.split(',')).then((s) => { if (vivo) setSeg(s) }) }
    cargar(); const t = window.setInterval(cargar, 120_000)
    return () => { vivo = false; window.clearInterval(t) }
  }, [clave])
  return seg
}

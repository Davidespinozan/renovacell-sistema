// VENTAS DEL EQUIPO (25 nov 2026, Roberto, jefe de ventas: «ver las ventas de todos los vendedores»). Lectura aparte
// (ventas_equipo, solo Dirección o jefe de ventas): NO cambia lo que el vendedor ve en Mis ventas, Inicio o Cobrar.
import { useCallback, useEffect, useState } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'
import type { OrderWithItems } from '../store/ordersStore'
import type { OrderMoney } from './money'

export interface Vendedor { id: string; email: string; name: string }
export interface VentasEquipo { orders: OrderWithItems[]; byOrder: Record<string, OrderMoney>; vendedores: Vendedor[] }
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

export function aVentasEquipo(data: unknown): VentasEquipo {
  const d = (data ?? {}) as { orders?: unknown[]; money?: unknown[]; vendedores?: Vendedor[] }
  const orders = (Array.isArray(d.orders) ? d.orders : []).map((o) => {
    const x = o as OrderWithItems & { items?: unknown }
    return { ...x, items: Array.isArray(x.items) ? x.items : [] } as OrderWithItems
  })
  const byOrder = Object.fromEntries((Array.isArray(d.money) ? d.money : []).map((m) => [(m as OrderMoney).order_id, m as OrderMoney]))
  return { orders, byOrder, vendedores: Array.isArray(d.vendedores) ? d.vendedores : [] }
}

export async function leerVentasEquipo(dias = 120): Promise<{ ok: true; datos: VentasEquipo } | { ok: false; mensaje: string }> {
  if (!hasSupabase) return { ok: true, datos: { orders: [], byOrder: {}, vendedores: [] } }
  const { data, error } = await rpc('ventas_equipo', { p_dias: dias })
  if (error) return { ok: false, mensaje: /NO_AUTORIZADO/.test(error.message ?? '') ? 'Solo Dirección y el jefe de ventas ven las ventas del equipo.' : 'No se pudieron cargar las ventas. Intenta de nuevo.' }
  return { ok: true, datos: aVentasEquipo(data) }
}

/** Ventas del equipo con recarga cada minuto mientras la pantalla está abierta. */
export function useVentasEquipo(leer: typeof leerVentasEquipo = leerVentasEquipo) {
  const [datos, setDatos] = useState<VentasEquipo>({ orders: [], byOrder: {}, vendedores: [] })
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    const r = await leer()
    if (r.ok) { setDatos(r.datos); setError(null) } else setError(r.mensaje)
    setCargando(false)
  }, [leer])
  useEffect(() => { void cargar(); const t = window.setInterval(() => void cargar(), 60_000); return () => window.clearInterval(t) }, [cargar])
  return { ...datos, cargando, error, recargar: cargar }
}

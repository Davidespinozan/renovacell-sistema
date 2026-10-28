// Metas y comisiones con backend: UNA lectura del servidor (comisiones_equipo) para Dirección y para el jefe de ventas
// (capacidad 'jefe_ventas'). Trae vendedores, pedidos del periodo con su vendedor y la línea de cada renglón, cobros del
// periodo y metas; sin cuentas internas. El cálculo es el mismo de siempre (estimarComisiones) en la pantalla.
import { useCallback, useEffect, useRef, useState } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'
import type { OrderWithItems } from '../hooks/useOrders'
import type { AsientoComision, LineaProducto, Vendedor } from '../comisiones'
import { DEFAULT_KEY, LINE_KEY, type SalesTarget } from '../store/metasStore'

type RenglonComision = OrderWithItems['items'][number] & { linea?: LineaProducto }
export type PedidoComision = Omit<OrderWithItems, 'items'> & { items: RenglonComision[] }
export interface DatosComisiones {
  vendedores: Vendedor[]
  pedidos: PedidoComision[]
  asientos: AsientoComision[]
  metas: SalesTarget[]
  puede_editar: boolean
}
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, args as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export async function leerComisionesEquipo(desde: string, hasta: string, rpc: Rpc = rpcPorDefecto): Promise<{ ok: true; data: DatosComisiones } | { ok: false; error: string }> {
  try {
    const { data, error } = await rpc('comisiones_equipo', { p_desde: desde, p_hasta: hasta })
    if (error) return { ok: false, error: /NO_AUTORIZADO/.test(error.message ?? '') ? 'Metas y comisiones son de Dirección y del jefe de ventas.' : 'No se pudieron cargar las metas y comisiones.' }
    return { ok: true, data: data as DatosComisiones }
  } catch { return { ok: false, error: 'No hay conexión con el servidor.' } }
}

/** Meta y tasas leídas del servidor (mismas filas especiales que metasStore: __default__, __rate_cosm__, __rate_prof__). */
export function metasDe(metas: SalesTarget[]) {
  const def = metas.find((t) => t.seller === DEFAULT_KEY) ?? { seller: DEFAULT_KEY, target: 0, commission_rate: 0.05 }
  return {
    targetFor: (seller: string) => metas.find((t) => t.seller === seller)?.target ?? def.target,
    lineRate: (line: LineaProducto) => metas.find((t) => t.seller === LINE_KEY[line])?.commission_rate ?? def.commission_rate,
  }
}

/** Línea de cada producto según los renglones que mandó el servidor. */
export function lineasDe(pedidos: DatosComisiones['pedidos']): Record<string, LineaProducto> {
  const m: Record<string, LineaProducto> = {}
  pedidos.forEach((o) => o.items.forEach((i) => { if (i.product_id && i.linea) m[i.product_id] = i.linea }))
  return m
}

/** Hook: con backend lee del servidor el periodo pedido; sin backend no hace nada (la pantalla usa los datos de demostración). */
export function useComisionesEquipo(desde: string | null, hasta: string | null, opts: { leer?: typeof leerComisionesEquipo } = {}) {
  const leer = opts.leer ?? leerComisionesEquipo
  const [datos, setDatos] = useState<DatosComisiones | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pedido = useRef(0)
  const recargar = useCallback(async () => {
    if (!desde || !hasta || (!hasSupabase && !opts.leer)) return
    const n = ++pedido.current
    const r = await leer(desde, hasta)
    if (n !== pedido.current) return
    if (r.ok) { setDatos(r.data); setError(null) } else setError(r.error)
  }, [desde, hasta, leer, opts.leer])
  useEffect(() => { void recargar() }, [recargar])
  return { datos, error, recargar }
}

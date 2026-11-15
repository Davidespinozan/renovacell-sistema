// CATÁLOGO · "MÁS PEDIDO" (15 nov 2026). Identificadores de los productos que más se piden (catalogo_mas_pedidos:
// agregado, sin montos ni clientes). Se pide una vez por sesión. Sin servidor (demo): se calcula con los pedidos locales.
import { useEffect, useMemo, useState } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'
import { useOrders } from '../hooks/useOrders'

let cache: Promise<Set<string>> | null = null
const pedir = (): Promise<Set<string>> => {
  cache ??= (async () => {
    try {
      const { data, error } = await supabase.rpc('catalogo_mas_pedidos' as never, { p_dias: 90, p_limite: 8 } as never)
      return error || !Array.isArray(data) ? new Set<string>() : new Set(data as string[])
    } catch { return new Set<string>() }
  })()
  return cache
}
const VACIO = new Set<string>()

/** Productos marcados como "Más pedido". */
export function useMasPedidos(): Set<string> {
  const { data: pedidos } = useOrders()
  // Demo: derivado (useMemo, sin estado ni efecto: nada que se vuelva a disparar en cada render).
  const local = useMemo(() => {
    if (hasSupabase) return VACIO
    const veces = new Map<string, number>()
    for (const o of pedidos) { if (o.status === 'cancelled' || o.status === 'draft') continue; for (const id of new Set(o.items.map((i) => i.product_id).filter(Boolean) as string[])) veces.set(id, (veces.get(id) ?? 0) + 1) }
    return new Set([...veces].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id))
  }, [pedidos])
  const [remoto, setRemoto] = useState<Set<string>>(VACIO)
  useEffect(() => {
    if (!hasSupabase) return
    let vivo = true
    void pedir().then((s) => { if (vivo) setRemoto(s) })
    return () => { vivo = false }
  }, [])
  return hasSupabase ? remoto : local
}

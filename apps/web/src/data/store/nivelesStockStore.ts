// NIVELES DE INVENTARIO POR PRODUCTO (27 nov 2026) · lectura y guardado. La base decide quién: los lee el personal de
// inventario (Dirección, Facturación, Almacén, Empaque) y solo Dirección los cambia (`stock_nivel_guardar`).
// En modo demostración viven en memoria, para que la pantalla se pueda probar sin servidor.
import { useEffect, useSyncExternalStore } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'
import { errorDeNivel, type NivelesStock } from '../ops/stock'

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

let actual: NivelesStock = {}
let pedido = false
const oyentes = new Set<() => void>()
const avisar = () => oyentes.forEach((f) => f())
const poner = (n: NivelesStock) => { actual = n; avisar() }

/** Lee los niveles propios. Si no se pudo, se quedan los que había (nunca se inventan). */
export async function cargarNiveles(rpc: Rpc = rpcPorDefecto): Promise<boolean> {
  if (!hasSupabase && rpc === rpcPorDefecto) return true
  try {
    const { data, error } = await rpc('stock_niveles')
    if (error || !Array.isArray(data)) return false
    const n: NivelesStock = {}
    for (const r of data as Array<{ product_id?: unknown; minimo?: unknown; ideal?: unknown }>) {
      if (typeof r.product_id === 'string' && Number.isFinite(Number(r.minimo)) && Number.isFinite(Number(r.ideal))) n[r.product_id] = { minimo: Number(r.minimo), ideal: Number(r.ideal) }
    }
    poner(n)
    return true
  } catch { return false }
}

/** El mensaje de la base, sin su código: «NIVEL_INVALIDO: el ideal no puede…» → «El ideal no puede…». */
export function mensajeDeNivel(m: string | null | undefined): string {
  const t = (m ?? '').replace(/^[A-Z_]+:\s*/, '').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'No se pudieron guardar los niveles. Intenta de nuevo.'
}

/** Guarda el nivel de un producto. Con `null` regresa al nivel general. Solo cambia la pantalla si el servidor lo aceptó. */
export async function guardarNivel(productId: string, nivel: { minimo: number; ideal: number } | null, rpc: Rpc = rpcPorDefecto): Promise<{ ok: true } | { ok: false; error: string }> {
  if (nivel) { const e = errorDeNivel(nivel.minimo, nivel.ideal); if (e) return { ok: false, error: e } }
  if (hasSupabase || rpc !== rpcPorDefecto) {
    try {
      const { error } = await rpc('stock_nivel_guardar', { p_product: productId, p_minimo: nivel ? nivel.minimo : null, p_ideal: nivel ? nivel.ideal : null })
      if (error) return { ok: false, error: mensajeDeNivel(error.message) }
    } catch { return { ok: false, error: 'No hay conexión con el servidor. Intenta de nuevo.' } }
  }
  const n = { ...actual }
  if (nivel) n[productId] = { minimo: nivel.minimo, ideal: nivel.ideal }; else delete n[productId]
  poner(n)
  return { ok: true }
}

/** Los niveles ya leídos en esta sesión (para quien no es un componente). */
export const nivelesActuales = (): NivelesStock => actual
export const _reiniciarNiveles = (): void => { actual = {}; pedido = false; avisar() }   // solo pruebas

const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f) } }
const foto = () => actual
/** Los niveles propios de cada producto (se piden una vez por sesión). */
export function useNivelesStock(): NivelesStock {
  const n = useSyncExternalStore(suscribir, foto, foto)
  useEffect(() => { if (!pedido) { pedido = true; void cargarNiveles() } }, [])
  return n
}

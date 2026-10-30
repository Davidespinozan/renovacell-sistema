// HERRAMIENTAS DEL VENDEDOR · bloque A (mig 20270214). Buscar una palabra en las conversaciones (las que quien busca puede
// ver) y, por producto, qué clientes lo compraron (vendedor: su cartera; jefe de ventas y Dirección: todos). La autoridad
// está en la base; aquí solo se llama y se presenta.
import { hasSupabase, supabase } from '../../lib/supabase'

export interface ResultadoMensaje {
  conversation_id: string; nombre: string; abierta: boolean; tuya: boolean; puede_abrir: boolean
  fecha: string; quien: string; texto: string; coincidencias: number
}
export interface ProductoCompradores { product_id: string; nombre: string; sku: string | null; categoria: string | null; activo: boolean; clientes: number; ultima: string | null }
export interface Comprador {
  customer_id: string; nombre: string; telefono: string | null; email: string | null; tiene_cuenta: boolean
  veces: number; unidades: number; ultima: string; ultimo_folio: string | null; vendedor: string | null
}

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>
async function lista<T>(rpc: Rpc, fn: string, args?: Record<string, unknown>): Promise<T[] | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return []
  try { const { data, error } = await rpc(fn, args); return error ? null : Array.isArray(data) ? data as T[] : [] } catch { return null }
}

/** null = no se pudo buscar (sin conexión o sin permiso). Menos de 3 letras: lista vacía sin llamar. */
export const buscarMensajes = (q: string, rpc: Rpc = rpcPorDefecto) => (q.trim().length < 3 ? Promise.resolve([] as ResultadoMensaje[]) : lista<ResultadoMensaje>(rpc, 'cc_buscar_mensajes', { p_q: q.trim(), p_limite: 40 }))
export const productosCompradores = (rpc: Rpc = rpcPorDefecto) => lista<ProductoCompradores>(rpc, 'cc_productos_compradores')
export const compradoresProducto = (id: string, rpc: Rpc = rpcPorDefecto) => lista<Comprador>(rpc, 'cc_compradores_producto', { p_product: id })

/** Normaliza como la base: minúsculas y sin acentos. */
export const normalizar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** El pedazo del mensaje alrededor de la palabra buscada, con la coincidencia separada para resaltarla. */
export function fragmento(texto: string, q: string, margen = 70): { antes: string; hallado: string; despues: string } {
  const i = normalizar(texto).indexOf(normalizar(q.trim()))
  if (i < 0) return { antes: texto.slice(0, margen * 2), hallado: '', despues: texto.length > margen * 2 ? '…' : '' }
  const fin = i + q.trim().length
  const ini = Math.max(0, i - margen)
  return { antes: (ini > 0 ? '…' : '') + texto.slice(ini, i), hallado: texto.slice(i, fin), despues: texto.slice(fin, fin + margen) + (fin + margen < texto.length ? '…' : '') }
}

/** Parte un texto en trozos normales y coincidencias (sin acentos ni mayúsculas), para resaltar dentro de un mensaje. */
export function partesResaltadas(texto: string, q: string): Array<{ t: string; hallado: boolean }> {
  const b = normalizar(q.trim())
  if (b.length < 2) return [{ t: texto, hallado: false }]
  const n = normalizar(texto); const out: Array<{ t: string; hallado: boolean }> = []
  let desde = 0
  for (let i = n.indexOf(b); i >= 0; i = n.indexOf(b, i + b.length)) {
    if (i > desde) out.push({ t: texto.slice(desde, i), hallado: false })
    out.push({ t: texto.slice(i, i + b.length), hallado: true }); desde = i + b.length
  }
  if (desde < texto.length) out.push({ t: texto.slice(desde), hallado: false })
  return out.length ? out : [{ t: texto, hallado: false }]
}

// MODIFICAR UN PEDIDO MIENTRAS NO SALE DE ALMACÉN (27 nov 2026, dueño: «hay que poder hacer modificaciones, agregar
// productos, etc., cuando el producto aún no ha salido a almacén»). El servidor (`pedido_modificar`) decide si se puede,
// pone los precios, recalcula envío, total y estado de pago, y deja rastro. Aquí: cuándo ofrecerlo y llamar.
import { hasSupabase, supabase } from '../../lib/supabase'
import type { OrderWithItems } from '../hooks/useOrders'

/** ¿Tiene sentido ofrecer «Modificar pedido»? Pista para la pantalla; la última palabra es del servidor. */
export function pedidoModificable(o: Pick<OrderWithItems, 'status' | 'shipping_meta' | 'items'>): boolean {
  if (!['pending_payment', 'paid'].includes(o.status ?? '')) return false
  if (((o.shipping_meta ?? {}) as { channel?: string }).channel === 'pos') return false
  return !o.items.some((i) => !!(i as { lot_id?: string | null }).lot_id)
}

export interface RenglonEdicion { product_id: string; qty: number }
export interface ResultadoModificacion { folio: string | null; total_antes: number; total: number; subtotal: number; envio_antes: number; envio: number; estado_pago: string | null }

const limpio = (m: string | undefined) => { const t = (m ?? '').replace(/^[A-Z_]+:\s*/, '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'No se pudo modificar el pedido.' }
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, args as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export async function modificarPedido(orderId: string, renglones: RenglonEdicion[], motivo: string, rpc: Rpc = rpcPorDefecto): Promise<{ ok: true; data: ResultadoModificacion } | { ok: false; error: string }> {
  const lineas = renglones.filter((r) => r.qty > 0)
  if (lineas.length === 0) return { ok: false, error: 'El pedido debe tener al menos un producto. Si ya no lo quieren, cancélalo.' }
  if (motivo.trim().length < 3) return { ok: false, error: 'Escribe por qué se modifica el pedido.' }
  if (!hasSupabase && rpc === rpcPorDefecto) return { ok: false, error: 'Modificar un pedido requiere conexión con el servidor.' }
  try {
    const { data, error } = await rpc('pedido_modificar', { p_order: orderId, p_lines: lineas.map((r) => ({ product_id: r.product_id, qty: r.qty })), p_motivo: motivo.trim() })
    if (error) return { ok: false, error: limpio(error.message) }
    const d = (data ?? {}) as Record<string, unknown>
    const n = (k: string) => Number(d[k] ?? 0)
    return { ok: true, data: { folio: (d.folio as string) ?? null, total_antes: n('total_antes'), total: n('total'), subtotal: n('subtotal'), envio_antes: n('envio_antes'), envio: n('envio'), estado_pago: (d.estado_pago as string) ?? null } }
  } catch { return { ok: false, error: 'No hay conexión con el servidor. Intenta de nuevo.' } }
}

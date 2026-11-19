// COBRO AL ENTREGAR (19 nov 2026, dueño: «por lo general sí cobra»). El chofer registra lo que cobró en la puerta
// (efectivo o transferencia); la base revisa que sea SU entrega, que no pase del saldo y que el pedido siga vivo, y lo
// asienta en el mismo libro de dinero que ve Dirección (registrar_cobro_entrega).
import { hasSupabase, supabase } from '../../lib/supabase'
import { newOpId } from './w1Command'

export interface EstadoCobro { order_id: string; total: number | null; cobrado: number | null; saldo: number; payment_status: string | null; credito: boolean; cancelado: boolean }
type Res<T> = { ok: true; data: T } | { ok: false; error: string }
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>
const msg = (m?: string) => { const t = (m ?? '').replace(/^[A-Z_]+:\s*/, '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'No se pudo registrar el cobro.' }

export const cobroEntrega = (rpc: Rpc = rpcPorDefecto) => ({
  estado: async (shipmentId: string): Promise<Res<EstadoCobro>> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return { ok: false, error: 'Sin conexión con el servidor.' }
    try { const { data, error } = await rpc('entrega_cobro_estado', { p_shipment: shipmentId }); return error ? { ok: false, error: msg(error.message) } : { ok: true, data: data as EstadoCobro } } catch { return { ok: false, error: 'Sin conexión con el servidor.' } }
  },
  registrar: async (shipmentId: string, metodo: 'efectivo' | 'transferencia', monto: number, referencia: string | null, opId = newOpId()): Promise<Res<{ saldo: number; payment_status: string }>> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return { ok: false, error: 'Sin conexión con el servidor.' }
    try {
      const { data, error } = await rpc('registrar_cobro_entrega', { p_op_id: opId, p_shipment: shipmentId, p_metodo: metodo, p_monto: monto, p_referencia: referencia })
      return error ? { ok: false, error: msg(error.message) } : { ok: true, data: data as { saldo: number; payment_status: string } }
    } catch { return { ok: false, error: 'Sin conexión: revisa tu señal y vuelve a intentarlo (no se cobra doble).' } }
  },
})

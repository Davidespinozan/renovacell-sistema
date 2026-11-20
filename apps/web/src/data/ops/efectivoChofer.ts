// EFECTIVO DEL CHOFER (BLOQUE1, 20 nov 2026). El chofer cobra en la puerta (registrar_cobro_entrega); al volver ENTREGA
// el efectivo en la oficina. Dirección/Facturación lo cuenta y lo RECIBE (recibir_efectivo_chofer = corte de cajero con
// el chofer como cajero; si no cuadra, pide motivo). El chofer ve cuánto trae (mi_efectivo_chofer).
import { hasSupabase, supabase } from '../../lib/supabase'
import { newOpId } from './w1Command'

export interface MiEfectivo { pendiente: number; desde: string; ultima_entrega: { at: string; contado: number } | null; cobros: Array<{ folio: string; monto: number; at: string }> }
export interface EfectivoDeChofer { driver_id: string; nombre: string; pendiente: number; cobros: number; desde: string }
type Res<T> = { ok: true; data: T } | { ok: false; error: string }
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>
const msg = (m?: string) => { const t = (m ?? '').replace(/^[A-Z_]+:\s*/, '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'No se pudo completar.' }
const SIN_RED = 'Sin conexión: revisa tu señal y vuelve a intentarlo.'

async function llamar<T>(rpc: Rpc, fn: string, args?: Record<string, unknown>): Promise<Res<T>> {
  if (!hasSupabase && rpc === rpcPorDefecto) return { ok: false, error: 'Sin conexión con el servidor.' }
  try { const { data, error } = await rpc(fn, args); return error ? { ok: false, error: msg(error.message) } : { ok: true, data: data as T } } catch { return { ok: false, error: SIN_RED } }
}

export const efectivoChofer = (rpc: Rpc = rpcPorDefecto) => ({
  mio: () => llamar<MiEfectivo>(rpc, 'mi_efectivo_chofer'),
  choferes: () => llamar<EfectivoDeChofer[]>(rpc, 'efectivo_choferes'),
  /** Mismo opId en un reintento = no se recibe doble. */
  recibir: (driverId: string, contado: number, motivo: string | null, opId = newOpId()) =>
    llamar<{ status: string; esperado: number; diferencia: number }>(rpc, 'recibir_efectivo_chofer', { p_op_id: opId, p_driver: driverId, p_contado: contado, p_motivo: motivo }),
})

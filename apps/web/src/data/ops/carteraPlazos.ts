// CARTERA-PLAZO (mig 20270327) · cada cliente se queda con su vendedor 180 días desde que lo atendió o desde su última
// compra pagada; si no le compra, pasa al siguiente vendedor en turno. Aquí: la lista con los días que quedan y el
// tablero de competencia entre vendedores (solo números por vendedor). La base decide qué ve cada quien.
import { hasSupabase, supabase } from '../../lib/supabase'

export interface ClientePlazo {
  tipo: 'cuenta' | 'ficha' | 'prospecto'; profile_id: string | null; customer_id: string | null; visitor_id: string | null
  nombre: string; telefono: string | null; dias_sin_compra: number; dias_restantes: number; vence: string; vendedor: string | null
}
export interface Plazos { plazo_dias: number; clientes: ClientePlazo[] }
export interface FilaRanking { vendedor: string; soy_yo: boolean; en_cartera: number; por_vencer_30: number; compraron_mes: number; rescatados_mes: number; nuevos_mes: number; perdidos_mes: number }

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

/** null = no se pudo cargar. `dias`: los que vencen dentro de esos días (730 = toda la cartera). */
export async function carteraPlazos(dias = 60, rpc: Rpc = rpcPorDefecto): Promise<Plazos | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return { plazo_dias: 180, clientes: [] }
  try { const { data, error } = await rpc('cc_cartera_plazos', { p_vendedor: null, p_dias: dias }); return error ? null : (data as Plazos) } catch { return null }
}
export async function carteraRanking(rpc: Rpc = rpcPorDefecto): Promise<FilaRanking[] | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return []
  try { const { data, error } = await rpc('cc_cartera_ranking'); return error ? null : Array.isArray(data) ? data as FilaRanking[] : [] } catch { return null }
}

/** Tono por urgencia: 7 días o menos, rojo; 30 o menos, ámbar. */
export const tonoPlazo = (dias: number): 'dang' | 'warn' | 'neu' => (dias <= 7 ? 'dang' : dias <= 30 ? 'warn' : 'neu')
export const textoPlazo = (dias: number): string => (dias <= 0 ? 'Vence hoy' : dias === 1 ? 'Le queda 1 día' : `Le quedan ${dias} días`)
export const textoSinCompra = (dias: number): string => (dias < 1 ? 'Asignado hoy' : dias === 1 ? '1 día sin comprar' : `${dias} días sin comprar`)

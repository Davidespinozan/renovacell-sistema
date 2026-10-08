// CARTERA-P1 · Cliente de la cartera del VENDEDOR (Clientes → Mi cartera / Cartera histórica). Solo RPC de lectura:
// la base resuelve la identidad (auth.uid()) y valida que sea personal de ventas activo; aquí no se pasa vendedor.
//   · Mi cartera = asignaciones VIGENTES (cc_cartera, CC-7).
//   · Cartera histórica = customers.seller_name heredado de Odoo, solo por equivalencias EXPLÍCITAS que registra
//     Dirección (igualdad exacta). NO son asignaciones.
import { hasSupabase, supabase } from '../../lib/supabase'

export interface AsignacionCartera { profile_id: string; customer_id: string | null; nombre: string; asignado_at: string }
export interface CarteraHistorica { equivalencias: string[]; clientes: Array<{ customer_id: string; seller_name: string }> }
export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

export function mensajeErrorCartera(m: string | undefined): string {
  if (/NO_AUTORIZADO|permission denied/.test(m ?? '')) return 'Tu cartera solo está disponible para el personal de ventas activo.'
  return 'No se pudo cargar tu cartera. Intenta de nuevo.'
}

export class ClienteCartera {
  constructor(private rpc: Rpc = rpcPorDefecto) {}
  private async llamar<T>(fn: string): Promise<Resultado<T>> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, error: 'La cartera requiere conexión con el servidor.' }
    try {
      const { data, error } = await this.rpc(fn)
      if (error) return { ok: false, error: mensajeErrorCartera(error.message) }
      return { ok: true, data: data as T }
    } catch { return { ok: false, error: 'No hay conexión con el servidor. Intenta de nuevo.' } }
  }
  miCartera() { return this.llamar<AsignacionCartera[]>('cc_mi_cartera') }
  miCarteraHistorica() { return this.llamar<CarteraHistorica>('cc_mi_cartera_historica') }
}
export const cartera = new ClienteCartera()

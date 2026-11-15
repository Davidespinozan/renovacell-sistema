// PROSPECCIÓN · «A QUIÉN LLAMAR HOY» (15 nov 2026). La lista del día de la cartera histórica de cada vendedora y el
// resultado de cada llamada. La base decide quién entra, en qué orden y qué pasa con cada resultado
// (prospeccion_hoy / prospeccion_registrar / prospeccion_resumen).
import { hasSupabase, supabase } from '../../lib/supabase'

export type ResultadoLlamada = 'interesado' | 'no_interesado' | 'no_contesto' | 'llamar_despues' | 'numero_equivocado' | 'ya_no_ejerce'
export const RESULTADOS: Array<{ key: ResultadoLlamada; label: string; tono: 'ok' | 'neutro' | 'aviso' | 'malo' }> = [
  { key: 'interesado', label: 'Le interesa', tono: 'ok' },
  { key: 'llamar_despues', label: 'Llamar otro día', tono: 'aviso' },
  { key: 'no_contesto', label: 'No contestó', tono: 'neutro' },
  { key: 'no_interesado', label: 'No le interesa', tono: 'neutro' },
  { key: 'numero_equivocado', label: 'Número equivocado', tono: 'malo' },
  { key: 'ya_no_ejerce', label: 'Ya no ejerce', tono: 'malo' },
]
export const QUE_PASA: Record<ResultadoLlamada, string> = {
  interesado: 'Entra a tu embudo de ventas.',
  llamar_despues: 'Vuelve a tu lista ese día y te llega un aviso.',
  no_contesto: 'Vuelve en 2 días (al 3er intento, en 30).',
  no_interesado: 'Descansa 90 días.',
  numero_equivocado: 'Sale de tu lista.',
  ya_no_ejerce: 'Sale de tu lista.',
}
export interface PorLlamar {
  customer_id: string; nombre: string; telefono: string; ciudad: string | null; tipo: string | null; especialidad: string | null
  intentos: number; ultimo: ResultadoLlamada | null; ultimo_at: string | null; ultima_nota: string | null; motivo: string
}
export interface ListaHoy {
  vendedor: string; lista: PorLlamar[]; por_llamar: number
  resumen: { hechas_hoy: number; interesados_hoy: number; hechas_semana: number; interesados_semana: number }
}
export interface AvanceVendedor { vendedor_id: string; vendedor: string; hoy: number; periodo: number; interesados: number; cartera: number }

type Res<T> = { ok: true; data: T } | { ok: false; error: string }
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>
const msg = (m?: string) => (m ?? '').replace(/^[A-Z_]+:\s*/, '') || 'No se pudo completar.'
async function llamar<T>(rpc: Rpc, fn: string, args?: Record<string, unknown>): Promise<Res<T>> {
  if (!hasSupabase && rpc === rpcPorDefecto) return { ok: false, error: 'Sin conexión con el servidor.' }
  try { const { data, error } = await rpc(fn, args); return error ? { ok: false, error: msg(error.message) } : { ok: true, data: data as T } } catch { return { ok: false, error: 'Sin conexión con el servidor.' } }
}

export const prospeccion = (rpc: Rpc = rpcPorDefecto) => ({
  hoy: (vendedor?: string | null, limite = 20) => llamar<ListaHoy>(rpc, 'prospeccion_hoy', { p_vendedor: vendedor ?? null, p_limite: limite }),
  registrar: (customerId: string, resultado: ResultadoLlamada, nota?: string | null, proxima?: string | null) =>
    llamar<{ id: string; resultado: ResultadoLlamada; oportunidad: unknown }>(rpc, 'prospeccion_registrar', { p_customer: customerId, p_resultado: resultado, p_nota: nota || null, p_proxima: proxima || null }),
  resumen: (dias = 7) => llamar<AvanceVendedor[]>(rpc, 'prospeccion_resumen', { p_dias: dias }),
})

/** Teléfono para marcar desde el celular: solo dígitos; 10 dígitos de México llevan +52. */
export function telMarcable(t: string): string {
  const d = t.replace(/\D/g, '')
  return d.length === 10 ? `+52${d}` : d.length === 12 && d.startsWith('52') ? `+${d}` : d
}

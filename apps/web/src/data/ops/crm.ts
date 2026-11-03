// CRM · EMBUDO DE VENTAS (2 nov 2026). Oportunidades por etapa: Nuevo → Calificado → Propuesta → Ganado (o Perdido con
// motivo). Avanzan solas con lo que pasa (mensaje, ficha ligada/verificada, cotización, pedido pagado) y el vendedor las
// mueve a mano. El vendedor ve las suyas; Dirección y el jefe de ventas, todas. Autoridad: el servidor.
import { hasSupabase, supabase } from '../../lib/supabase'

export type Etapa = 'nuevo' | 'calificado' | 'propuesta' | 'ganado' | 'perdido'
export const ETAPAS: Array<{ key: Etapa; label: string; pista: string }> = [
  { key: 'nuevo', label: 'Nuevo', pista: 'Escribió y aún no se califica' },
  { key: 'calificado', label: 'Calificado', pista: 'Verificado o ligado a su ficha' },
  { key: 'propuesta', label: 'Propuesta', pista: 'Tiene cotización o pedido por pagar' },
  { key: 'ganado', label: 'Ganado', pista: 'Pedido pagado' },
]
export const ORIGEN: Record<string, string> = { whatsapp: 'WhatsApp', portal: 'Portal', enlace: 'Enlace', vendedor: 'Vendedor', cotizacion: 'Cotización', pedido: 'Pedido' }
export interface Oportunidad {
  id: string; etapa: Etapa; titulo: string | null; monto: number | null; origen: string; customer_id: string | null; conversation_id: string | null
  cliente: string; vendedor_id: string | null; vendedor: string | null; cotizacion_id: string | null; order_id: string | null; folio_pedido: string | null
  motivo_perdida: string | null; etapa_at: string; created_at: string; cerrada_at: string | null; dias_en_etapa: number
}
export interface ResumenCrm {
  por_etapa: Partial<Record<Etapa, { n: number; monto: number }>>
  por_vendedor: Array<{ vendedor_id: string | null; vendedor: string | null; abiertas: number; ganadas: number; perdidas: number; ganado_monto: number }>
  conversion: number | null; dias: number
}
type Res<T> = { ok: true; data: T } | { ok: false; error: string }
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>
const msg = (m?: string) => (m ?? '').replace(/^[A-Z_]+:\s*/, '') || 'No se pudo completar.'
async function llamar<T>(rpc: Rpc, fn: string, args?: Record<string, unknown>): Promise<Res<T>> {
  if (!hasSupabase && rpc === rpcPorDefecto) return { ok: false, error: 'Sin conexión con el servidor.' }
  try { const { data, error } = await rpc(fn, args); return error ? { ok: false, error: msg(error.message) } : { ok: true, data: data as T } } catch { return { ok: false, error: 'Sin conexión con el servidor.' } }
}
export const crm = (rpc: Rpc = rpcPorDefecto) => ({
  embudo: (vendedor?: string | null, cerradasDias = 30) => llamar<Oportunidad[]>(rpc, 'crm_embudo', { p_vendedor: vendedor ?? null, p_cerradas_dias: cerradasDias }),
  mover: (id: string, etapa: Etapa, motivo?: string) => llamar<Oportunidad>(rpc, 'crm_mover', { p_id: id, p_etapa: etapa, p_motivo: motivo ?? null }),
  crear: (customerId: string, titulo?: string, monto?: number | null) => llamar<Oportunidad>(rpc, 'crm_crear', { p_customer: customerId, p_titulo: titulo ?? null, p_monto: monto ?? null }),
  editar: (id: string, cambios: { titulo?: string; monto?: number | null; vendedor?: string | null }) => llamar<Oportunidad>(rpc, 'crm_editar', { p_id: id, p_titulo: cambios.titulo ?? null, p_monto: cambios.monto ?? null, p_vendedor: cambios.vendedor ?? null }),
  resumen: (dias = 30) => llamar<ResumenCrm>(rpc, 'crm_resumen', { p_dias: dias }),
})
/** Totales por columna (lo abierto y lo cerrado del periodo que trae el embudo). */
export function totalesPorEtapa(ops: Oportunidad[]): Record<Etapa, { n: number; monto: number }> {
  const t = { nuevo: { n: 0, monto: 0 }, calificado: { n: 0, monto: 0 }, propuesta: { n: 0, monto: 0 }, ganado: { n: 0, monto: 0 }, perdido: { n: 0, monto: 0 } }
  for (const o of ops) { t[o.etapa].n++; t[o.etapa].monto += o.monto ?? 0 }
  return t
}

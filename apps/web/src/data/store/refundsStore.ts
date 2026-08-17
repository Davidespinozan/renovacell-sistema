// DEVOLUCIONES / CORRECCIONES (append-only). Con backend escribe SOLO por la RPC
// `registrar_devolucion` (SECURITY DEFINER: valida rol, motivo y TOPE del lado
// servidor). El pedido original NUNCA se toca; una devolución es un registro nuevo
// que lo referencia. Los reportes restan estas devoluciones del neto.
import { hasSupabase, supabase } from '../../lib/supabase'
import { logAudit } from './auditStore'
import { makeLive } from './live'
import type { Json } from '../database.types'

export type RefundTipo = 'devolucion' | 'correccion' | 'cortesia'

// Renglón devuelto (para reingresar al inventario): el lote al que vuelve y cuántas piezas.
export interface RefundItem { item_id?: string; lot_id: string | null; qty: number }

export interface Refund {
  id: string
  order_id: string
  tipo: RefundTipo
  monto: number
  motivo: string
  metodo: string | null
  usuario: string
  created_at: string
  items?: RefundItem[] | null
}

const live = makeLive<Refund>(async () => {
  const { data, error } = await supabase.from('refunds')
    .select('id, order_id, tipo, monto, motivo, metodo, usuario, created_at, items')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Refund[]
}, [])

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

// Cuánto se ha devuelto por pedido (para calcular el restante y mostrarlo en la ficha).
export function refundedByOrder(refunds: Refund[]): Record<string, number> {
  const m: Record<string, number> = {}
  refunds.forEach((r) => { m[r.order_id] = (m[r.order_id] ?? 0) + r.monto })
  return m
}

// Piezas YA devueltas por renglón (item_id) de un pedido — para topar cuánto más se
// puede devolver de cada producto.
export function returnedByItem(refunds: Refund[], orderId: string): Record<string, number> {
  const m: Record<string, number> = {}
  refunds.filter((r) => r.order_id === orderId).forEach((r) => {
    (r.items ?? []).forEach((it) => { if (it.item_id) m[it.item_id] = (m[it.item_id] ?? 0) + (it.qty ?? 0) })
  })
  return m
}

export interface RegistrarInput { orderId: string; tipo: RefundTipo; monto: number; motivo: string; usuario: string; items?: RefundItem[] }

// Traduce los códigos de error de la RPC a mensajes claros para el usuario.
function traducir(msg: string): string {
  if (msg.includes('MONTO_EXCEDE')) return 'El monto supera lo que resta por devolver de este pedido.'
  if (msg.includes('MOTIVO_REQUERIDO')) return 'Escribe el motivo de la devolución.'
  if (msg.includes('MONTO_INVALIDO')) return 'El monto debe ser mayor a cero.'
  if (msg.includes('TIPO_INVALIDO')) return 'Tipo de devolución inválido.'
  if (msg.includes('NO_AUTORIZADO')) return 'No tienes permiso para registrar devoluciones.'
  if (msg.includes('PEDIDO_INVALIDO')) return 'Ese pedido no admite devolución.'
  return msg
}

export async function registrarDevolucion(input: RegistrarInput): Promise<{ ok: boolean; error?: string; restante?: number }> {
  if (input.monto <= 0) return { ok: false, error: 'El monto debe ser mayor a cero.' }
  if (!input.motivo.trim()) return { ok: false, error: 'Escribe el motivo de la devolución.' }

  const items = input.tipo === 'devolucion' ? (input.items ?? []) : []

  if (!hasSupabase) {
    // Modo local (sin backend): registra optimista para poder ver el flujo.
    const r: Refund = {
      id: globalThis.crypto?.randomUUID?.() ?? `rf-${Date.now()}`,
      order_id: input.orderId, tipo: input.tipo, monto: input.monto,
      motivo: input.motivo.trim(), metodo: null, usuario: input.usuario,
      created_at: new Date().toISOString(), items,
    }
    live.setLocal([r, ...live.current()])
    return { ok: true }
  }

  const { data, error } = await supabase.rpc('registrar_devolucion', {
    p_order_id: input.orderId, p_tipo: input.tipo, p_monto: input.monto,
    p_motivo: input.motivo.trim(), p_usuario: input.usuario,
    p_items: items as unknown as Json,
  })
  if (error) return { ok: false, error: traducir(error.message) }
  logAudit({ actor: input.usuario, action: input.tipo === 'correccion' ? 'Corrección de cobro' : 'Devolución', resource: input.orderId, detail: `$${input.monto} · ${input.motivo.trim()}` })
  live.reload()
  const restante = (data as { restante?: number } | null)?.restante
  return { ok: true, restante }
}
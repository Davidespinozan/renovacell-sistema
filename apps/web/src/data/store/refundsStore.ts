// REEMBOLSOS / CORRECCIONES (append-only). W2 los divide en DOS HECHOS:
//   1) AUTORIZAR (`autorizar_reembolso`) — queda el compromiso. El dinero NO ha salido.
//   2) PAGAR    (`pagar_reembolso`)      — sale el dinero: nace el asiento 'out'.
// Un reembolso autorizado y no pagado es una deuda con el cliente, y así se muestra
// (v_order_money.reembolso_pendiente). El pedido original NUNCA se toca.
//
// La ENTRADA FÍSICA del producto NO vive aquí: la registra Almacén con
// `recibir_devolucion` y la dispone Dirección con `disponer_devolucion` (W1).
import { hasSupabase, supabase } from '../../lib/supabase'
import { logAudit } from './auditStore'
import { makeLive } from './live'
import { autorizarReembolso as cmdAutorizar, pagarReembolso as cmdPagar, type PaymentMethod } from '../ops/money'
import { reloadMoney } from './moneyStore'
import { leerTodo } from './lectura'

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
  const { data, error } = await leerTodo('los reembolsos', (a, b) => supabase.from('refunds')
    .select('id, order_id, tipo, monto, motivo, metodo, usuario, created_at, items')
    .order('created_at', { ascending: false }).order('id').range(a, b))
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

export interface RegistrarInput { orderId: string; tipo: RefundTipo; monto: number; motivo: string; usuario: string; items?: RefundItem[]; returnId?: string | null }

export interface RefundResult { ok: boolean; error?: string; ambiguous?: boolean; refundId?: string; restante?: number }

// 1) AUTORIZAR el reembolso. No mueve dinero: deja el compromiso registrado.
// El servidor valida rol, motivo, tipo y que no se autorice más de lo cobrado.
export async function autorizarReembolso(opId: string, input: RegistrarInput): Promise<RefundResult> {
  if (input.monto <= 0) return { ok: false, error: 'El monto debe ser mayor a cero.' }
  if (!input.motivo.trim()) return { ok: false, error: 'Escribe el motivo del reembolso.' }

  if (!hasSupabase) {
    // Demo (sin backend): registro optimista para poder ver el flujo.
    const r: Refund = {
      id: globalThis.crypto?.randomUUID?.() ?? `rf-${Date.now()}`,
      order_id: input.orderId, tipo: input.tipo, monto: input.monto,
      motivo: input.motivo.trim(), metodo: null, usuario: input.usuario,
      created_at: new Date().toISOString(), items: input.items ?? [],
    }
    live.setLocal([r, ...live.current()])
    return { ok: true, refundId: r.id }
  }

  const r = await cmdAutorizar(opId, {
    orderId: input.orderId, tipo: input.tipo, monto: input.monto,
    motivo: input.motivo.trim(), returnId: input.returnId ?? null, usuario: input.usuario,
  })
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
  if (r.status === 'applied') {
    logAudit({
      actor: input.usuario,
      action: input.tipo === 'correccion' ? 'Corrección de cobro autorizada' : input.tipo === 'cortesia' ? 'Cortesía autorizada' : 'Reembolso autorizado',
      resource: input.orderId, detail: `$${input.monto} · ${input.motivo.trim()} · el dinero aún NO ha salido`,
    })
  }
  await Promise.all([live.reload(), reloadMoney()])
  return { ok: true, refundId: r.data.refund_id, restante: r.data.restante }
}

// 2) PAGAR el reembolso: aquí SÍ sale el dinero (asiento 'out' en el libro).
// Devolver por una vía distinta a la del cobro exige motivo (el servidor lo exige).
export async function pagarReembolso(opId: string, a: {
  refundId: string; method: PaymentMethod; fechaValor?: string | null; reference?: string | null; motivoVia?: string | null; usuario?: string
}): Promise<RefundResult & { monto?: number }> {
  if (!hasSupabase) {
    live.setLocal(live.current().map((r) => (r.id === a.refundId ? { ...r, metodo: a.method } : r)))
    return { ok: true, refundId: a.refundId }
  }
  const r = await cmdPagar(opId, a)
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
  if (r.status === 'applied') {
    logAudit({ actor: a.usuario ?? 'Administración', action: 'Reembolso pagado', resource: a.refundId, detail: `$${r.data.monto} · ${a.method}${r.data.misma_via ? '' : ' · vía distinta a la del cobro'}` })
  }
  await Promise.all([live.reload(), reloadMoney()])
  return { ok: true, refundId: a.refundId, monto: r.data.monto }
}

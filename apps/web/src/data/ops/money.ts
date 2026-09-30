// W2 · DINERO — cliente único de los comandos y de la lectura del dinero.
//
// Reglas que este módulo hace cumplir en el frontend:
//  · `payment_entries` (el libro) es la ÚNICA verdad del dinero. Ninguna pantalla
//    suma/resta dinero por su cuenta: todo sale de `v_order_money` (definición única).
//  · `payment_status` es una PROYECCIÓN financiera del libro. El frontend NO lo escribe
//    (la base lo rechaza con PAGO_SOLO_POR_COMANDO); lo lee y lo muestra.
//  · REPORTAR ≠ COBRAR: el cliente declara (`reportar_pago` → payment_claims) y
//    Facturación verifica (`revisar_pago`); solo la verificación crea el asiento.
//  · Liberado para surtir = cobro suficiente O crédito autorizado vigente. El crédito
//    NO se muestra ni se guarda como "pagado" (ni en payment_status ni en status).
//  · Devolución física (W1) y reembolso financiero (W2) son hechos separados:
//    `autorizar_reembolso` no mueve dinero; `pagar_reembolso` lo saca del libro.
import { supabase, hasSupabase } from '../../lib/supabase'
import { runW2Command, type W1Result } from './w1Command'

export type PaymentMethod = 'transferencia' | 'efectivo' | 'tarjeta' | 'stripe' | 'otro'
export type EstadoPago = 'pending' | 'parcial' | 'paid' | 'refunded'
export type RefundTipo = 'devolucion' | 'correccion' | 'cortesia'

export const METODOS: { value: PaymentMethod; label: string }[] = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'stripe', label: 'Pago en línea (Stripe)' },
  { value: 'otro', label: 'Otro' },
]

// Fila de `v_order_money`: el dinero de un pedido, tal como lo define el servidor.
export interface OrderMoney {
  order_id: string
  external_ref: string | null
  order_status: string | null
  payment_status: string | null
  total: number
  cobrado: number
  reembolsado: number
  cobrado_neto: number
  saldo: number
  estado_pago: EstadoPago
  sobrepago: boolean
  reembolso_pendiente: number
  credito_autorizado: boolean
  due_date: string | null
  vencido: boolean
  liberado: boolean
}

export const MONEY_COLS =
  'order_id, external_ref, order_status, payment_status, total, cobrado, reembolsado, cobrado_neto, saldo, ' +
  'estado_pago, sobrepago, reembolso_pendiente, credito_autorizado, due_date, vencido, liberado'

// Declaración de pago del cliente (comprobante en revisión).
export interface PaymentClaim {
  id: string
  order_id: string
  method: PaymentMethod
  amount_declared: number
  reference: string | null
  bank_account_id: string | null
  proof_path: string | null
  status: 'reportado' | 'verificado' | 'rechazado'
  declared_by: string | null
  declared_at: string
  resolved_at: string | null
  reject_reason: string | null
  entry_id: string | null
}

export const CLAIM_COLS =
  'id, order_id, method, amount_declared, reference, bank_account_id, proof_path, status, declared_by, ' +
  'declared_at, resolved_at, reject_reason, entry_id'

// Asiento del libro (append-only).
export interface PaymentEntry {
  id: string
  order_id: string
  claim_id: string | null
  refund_id: string | null
  direction: 'in' | 'out'
  method: PaymentMethod
  amount: number
  value_date: string
  external_ref: string | null
  bank_account_id: string | null
  reversal_of: string | null
  notes: string | null
  actor_role: string | null
  created_at: string
}

export const ENTRY_COLS =
  'id, order_id, claim_id, refund_id, direction, method, amount, value_date, external_ref, bank_account_id, ' +
  'reversal_of, notes, actor_role, created_at'

// ¿Este reembolso autorizado YA salió de la caja? Un egreso lo paga; su reversa lo
// vuelve a dejar pendiente (misma aritmética que `v_order_money.reembolso_pendiente`).
export function reembolsoPagado(entries: PaymentEntry[], refundId: string): boolean {
  const neto = entries
    .filter((e) => e.refund_id === refundId)
    .reduce((s, e) => s + (e.direction === 'out' ? e.amount : -e.amount), 0)
  return neto > 0.0001
}

// --- LECTURA -----------------------------------------------------------------

// El dinero de UN pedido (vista única). null si no hay backend o no es visible.
export async function moneyOf(orderId: string): Promise<OrderMoney | null> {
  if (!hasSupabase) return null
  const { data, error } = await supabase.from('v_order_money').select(MONEY_COLS).eq('order_id', orderId).maybeSingle()
  if (error || !data) return null
  return data as unknown as OrderMoney
}

// El dinero de varios pedidos de un jalón (cobranza, listas). Mapa por order_id.
export async function moneyByOrder(orderIds?: string[]): Promise<Record<string, OrderMoney>> {
  if (!hasSupabase) return {}
  let q = supabase.from('v_order_money').select(MONEY_COLS)
  if (orderIds && orderIds.length > 0) q = q.in('order_id', orderIds)
  const { data, error } = await q
  if (error || !data) return {}
  return Object.fromEntries((data as unknown as OrderMoney[]).map((m) => [m.order_id, m]))
}

// Ficha completa (dinero + declaraciones + asientos) por el comando de lectura.
export async function estadoDineroPedido(orderId: string): Promise<(OrderMoney & {
  claims: { id: string; status: string; method: string; monto: number; declarado: string; motivo_rechazo: string | null }[]
  asientos: { id: string; direction: 'in' | 'out'; method: string; monto: number; fecha_valor: string; reversa_de: string | null }[]
}) | null> {
  if (!hasSupabase) return null
  const { data, error } = await supabase.rpc('estado_dinero_pedido', { p_order: orderId })
  if (error || !data || typeof data !== 'object') return null
  return data as never
}

// Efectivo esperado del PRÓXIMO corte — lo calcula el SERVIDOR desde el libro (F-10).
// Un corte cerrado establece un límite: esto solo cuenta lo posterior a ese límite
// (D-W2-CASH-CUTOFF). El cliente nunca resta nada.
export async function efectivoEsperadoServidor(fecha: string, alcance: 'dia' | 'cajero' = 'dia', cajero?: string | null): Promise<number | null> {
  if (!hasSupabase) return null
  const { data, error } = await supabase.rpc('efectivo_esperado', { p_fecha: fecha, p_alcance: alcance, p_cajero: cajero ?? undefined })
  if (error) return null
  return Number(data ?? 0)
}

// El TRAMO que arquearía el próximo corte: desde dónde, hasta ahora, cuánto, y si
// continúa a un corte anterior o reabre uno anulado. Sirve para EXPLICAR el número.
export interface TramoCorte {
  desde: string
  hasta: string
  esperado: number
  primer_corte: boolean
  continua_de: string | null
  reabre_anulado: string | null
}
export async function tramoCorteCaja(fecha: string, alcance: 'dia' | 'cajero' = 'dia', cajero?: string | null): Promise<TramoCorte | null> {
  if (!hasSupabase) return null
  const { data, error } = await supabase.rpc('tramo_corte_caja', { p_fecha: fecha, p_alcance: alcance, p_cajero: cajero ?? undefined })
  if (error || !data || typeof data !== 'object') return null
  const t = data as unknown as TramoCorte
  return { ...t, esperado: Number(t.esperado ?? 0) }
}

// --- COMANDOS ----------------------------------------------------------------
// Cada uno recibe el op_id de la INTENCIÓN (useOpId): un reintento no duplica dinero.

export const reportarPago = (opId: string, a: {
  orderId: string; method: PaymentMethod; amount: number
  reference?: string | null; bankAccountId?: string | null; proofPath?: string | null
}) => runW2Command<{ claim_id: string; order_id: string; saldo: number }>('reportar_pago', {
  p_op_id: opId, p_order: a.orderId, p_method: a.method, p_amount: a.amount,
  p_reference: a.reference ?? undefined, p_bank_account_id: a.bankAccountId ?? undefined, p_proof_path: a.proofPath ?? undefined,
}, opId)

export const revisarPago = (opId: string, a: {
  claimId: string; accion: 'verificar' | 'rechazar'
  montoVerificado?: number | null; fechaValor?: string | null; motivo?: string | null
}) => runW2Command<{ resultado?: string; claim_id: string; entry_id?: string; monto?: number; payment_status?: string }>('revisar_pago', {
  p_op_id: opId, p_claim_id: a.claimId, p_accion: a.accion,
  p_amount_verificado: a.montoVerificado ?? undefined, p_value_date: a.fechaValor ?? undefined, p_motivo: a.motivo ?? undefined,
}, opId)

export const registrarCobro = (opId: string, a: {
  orderId: string; method: PaymentMethod; amount: number
  fechaValor?: string | null; reference?: string | null; bankAccountId?: string | null; evidence?: string | null
}) => runW2Command<{ entry_id: string; order_id: string; payment_status: string; cobrado_neto: number; saldo: number; sobrepago: boolean; sobre_pedido_cancelado: boolean }>('registrar_cobro', {
  p_op_id: opId, p_order: a.orderId, p_method: a.method, p_amount: a.amount,
  p_value_date: a.fechaValor ?? undefined, p_reference: a.reference ?? undefined,
  p_bank_account_id: a.bankAccountId ?? undefined, p_evidence: a.evidence ?? undefined,
}, opId)

export const autorizarReembolso = (opId: string, a: {
  orderId: string; tipo: RefundTipo; monto: number; motivo: string; returnId?: string | null; usuario?: string | null
}) => runW2Command<{ refund_id: string; restante: number; nota: string }>('autorizar_reembolso', {
  p_op_id: opId, p_order: a.orderId, p_tipo: a.tipo, p_monto: a.monto, p_motivo: a.motivo,
  p_return_id: a.returnId ?? undefined, p_usuario: a.usuario ?? undefined,
}, opId)

export const pagarReembolso = (opId: string, a: {
  refundId: string; method: PaymentMethod; fechaValor?: string | null; reference?: string | null; motivoVia?: string | null
}) => runW2Command<{ entry_id: string; refund_id: string; monto: number; misma_via: boolean; payment_status: string }>('pagar_reembolso', {
  p_op_id: opId, p_refund_id: a.refundId, p_method: a.method,
  p_value_date: a.fechaValor ?? undefined, p_reference: a.reference ?? undefined, p_motivo_via: a.motivoVia ?? undefined,
}, opId)

export const autorizarCredito = (opId: string, a: { orderId: string; dueDate: string; motivo: string }) =>
  runW2Command<{ grant_id: string; order_id: string; due_date: string; liberado: boolean; payment_status: string | null; saldo: number }>('autorizar_credito', {
    p_op_id: opId, p_order: a.orderId, p_due_date: a.dueDate, p_motivo: a.motivo,
  }, opId)

export const revocarCredito = (opId: string, a: { orderId: string; motivo: string }) =>
  runW2Command<{ grant_id: string; order_id: string; liberado: boolean }>('revocar_credito', {
    p_op_id: opId, p_order: a.orderId, p_motivo: a.motivo,
  }, opId)

export const reversarAsiento = (opId: string, a: { entryId: string; motivo: string }) =>
  runW2Command<{ entry_id: string; reversa_de: string; payment_status: string }>('reversar_asiento', {
    p_op_id: opId, p_entry_id: a.entryId, p_motivo: a.motivo,
  }, opId)

export const registrarCorteCaja = (opId: string, a: {
  fecha: string; alcance: 'dia' | 'cajero'; fondo: number; contado: number; motivo?: string | null; cajero?: string | null
}) => runW2Command<{ closing_id: string; esperado: number; contado: number; diferencia: number }>('registrar_corte_caja', {
  p_op_id: opId, p_fecha: a.fecha, p_alcance: a.alcance, p_fondo: a.fondo, p_contado: a.contado,
  p_motivo: a.motivo ?? undefined, p_cajero: a.cajero ?? undefined,
}, opId)

export const anularCorteCaja = (opId: string, a: { closingId: string; motivo: string }) =>
  runW2Command<{ anulacion_id?: string; closing_id: string }>('anular_corte_caja', {
    p_op_id: opId, p_closing_id: a.closingId, p_motivo: a.motivo,
  }, opId)

export type MoneyResult<T = Record<string, unknown>> = W1Result<T>

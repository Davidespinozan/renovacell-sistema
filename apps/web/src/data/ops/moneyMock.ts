// W2 · Adaptador SOLO para el modo demo (sin backend). En producción el dinero viene de
// `v_order_money` y `payment_claims`; aquí se deriva de las semillas para que la demo
// siga mostrando el flujo completo (reportar → validar → cobrar) sin inventar reglas.
// Ninguna de estas funciones se usa cuando hay backend.
import type { OrderMoney, PaymentClaim, PaymentMethod } from './money'

interface OrdenMock {
  id: string
  external_ref: string | null
  status: string | null
  payment_status: string | null
  total: number | null
  shipping_meta?: unknown
}

interface TransferMock {
  reported?: boolean
  at?: string
  reference?: string
  proof_path?: string | null
  bank_account_id?: string | null
  review?: { status?: string; reviewed_at?: string; reason?: string }
}

const transferDe = (o: OrdenMock): TransferMock | null =>
  ((o.shipping_meta as { transfer?: TransferMock } | null)?.transfer ?? null)

// Deriva la fila de dinero de un pedido con lo único observable en demo:
// si quedó pagado y cuánto se devolvió.
export function moneyFromOrder(o: OrdenMock, reembolsado = 0, credito?: { due_date: string } | null, hoy?: string): OrderMoney {
  const total = o.total ?? 0
  const cobrado = o.payment_status === 'paid' ? total : 0
  const neto = cobrado - reembolsado
  const estado: OrderMoney['estado_pago'] =
    reembolsado > 0 && neto <= 0 ? 'refunded'
      : neto >= total && cobrado > 0 ? 'paid'
        : neto > 0 ? 'parcial' : 'pending'
  const due = credito?.due_date ?? null
  const vencido = !!due && !!hoy && due < hoy
  return {
    order_id: o.id, external_ref: o.external_ref, order_status: o.status, payment_status: o.payment_status,
    total, cobrado, reembolsado, cobrado_neto: neto, saldo: total - neto, estado_pago: estado,
    sobrepago: neto > total, reembolso_pendiente: 0,
    credito_autorizado: !!credito, due_date: due, vencido,
    liberado: (neto >= total && total > 0) || !!credito,
  }
}

// Los comprobantes de la demo viven en el JSON viejo (shipping_meta.transfer).
export function claimsFromOrders(orders: OrdenMock[]): PaymentClaim[] {
  const out: PaymentClaim[] = []
  orders.forEach((o) => {
    const t = transferDe(o)
    if (!t) return
    const rev = t.review?.status
    out.push({
      id: `claim-${o.id}`, order_id: o.id, method: 'transferencia' as PaymentMethod,
      amount_declared: o.total ?? 0, reference: t.reference ?? null,
      bank_account_id: t.bank_account_id ?? null, proof_path: t.proof_path ?? null,
      status: rev === 'confirmed' ? 'verificado' : rev === 'rejected' ? 'rechazado' : 'reportado',
      declared_by: null, declared_at: t.at ?? new Date().toISOString(),
      resolved_at: t.review?.reviewed_at ?? null, reject_reason: t.review?.reason ?? null,
      entry_id: rev === 'confirmed' ? `entry-${o.id}` : null,
    })
  })
  return out.sort((a, b) => (a.declared_at < b.declared_at ? 1 : -1))
}

// Asientos de la demo: sin libro, lo único observable es que un pedido quedó pagado
// (entra su total el día del pedido) y qué reembolsos se registraron (salen ese día).
// Con backend NUNCA se usa: el cobrado sale de `payment_entries`.
export function entriesFromOrders(
  orders: (OrdenMock & { created_at: string })[],
  refunds: { order_id: string; monto: number; created_at: string }[],
  dia: (instante: string) => string,
): { order_id: string; direction: 'in' | 'out'; amount: number; value_date: string }[] {
  const out: { order_id: string; direction: 'in' | 'out'; amount: number; value_date: string }[] = []
  const pagados = new Set<string>()
  orders.forEach((o) => {
    if (o.payment_status !== 'paid' || !(o.total && o.total > 0)) return
    pagados.add(o.id)
    out.push({ order_id: o.id, direction: 'in', amount: o.total, value_date: dia(o.created_at) })
  })
  refunds.forEach((r) => {
    if (pagados.has(r.order_id) && r.monto > 0) out.push({ order_id: r.order_id, direction: 'out', amount: r.monto, value_date: dia(r.created_at) })
  })
  return out
}

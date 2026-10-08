// PAY-EXP-01A-3 · UN SOLO universo de declaraciones pendientes para el contador de Bandeja y la lista de
// "Pagos por validar" (antes el contador incluía declaraciones de pedidos cancelados que la lista ocultaba).
//   · vigentes      = declaraciones 'reportado' de pedidos NO cancelados → "Pagos por validar".
//   · enCancelados  = declaraciones 'reportado' de pedidos cancelados    → "Revisión económica".
//   · sin pedido cargado: NO se descartan; cuentan y se listan en "Pagos por validar" con aviso (un pedido que
//     aún no llegó al navegador no es motivo para esconder una declaración).
import type { PaymentClaim } from './money'
import type { OrderWithItems } from '../store/ordersStore'

export interface DeclaracionPendiente { claim: PaymentClaim; order: OrderWithItems | null }
export interface DeclaracionesPendientes { vigentes: DeclaracionPendiente[]; enCancelados: DeclaracionPendiente[] }

export function clasificarDeclaraciones(claims: PaymentClaim[], orders: OrderWithItems[]): DeclaracionesPendientes {
  const byId = new Map(orders.map((o) => [o.id, o]))
  const abiertas = claims
    .filter((c) => c.status === 'reportado')
    .map((claim) => ({ claim, order: byId.get(claim.order_id) ?? null }))
    .sort((a, b) => (a.claim.declared_at < b.claim.declared_at ? 1 : -1))
  return {
    vigentes: abiertas.filter((r) => r.order?.status !== 'cancelled'),
    enCancelados: abiertas.filter((r) => r.order?.status === 'cancelled'),
  }
}

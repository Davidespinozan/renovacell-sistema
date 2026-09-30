// W2 · Cómo se MUESTRA el dinero. Funciones puras (sin red) para que las pantallas
// no inventen etiquetas ni sumas.
//
// Regla dura: un crédito autorizado JAMÁS se presenta como "pagado". El pedido puede
// estar liberado para surtir y seguir debiendo: son dos hechos distintos y se muestran
// como dos hechos distintos.
import type { OrderMoney } from './money'

export type Tono = 'ok' | 'warn' | 'bad' | 'muted'

export interface EtiquetaPago { texto: string; tono: Tono; detalle?: string }

const fecha = (iso: string | null): string => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}

// Estado FINANCIERO del pedido (lo que el libro dice que entró y salió).
export function etiquetaPago(m: Pick<OrderMoney, 'estado_pago' | 'saldo' | 'cobrado_neto' | 'total' | 'sobrepago'>): EtiquetaPago {
  if (m.sobrepago) return { texto: 'Sobrepago', tono: 'warn', detalle: `Entró ${m.cobrado_neto} sobre un total de ${m.total}` }
  switch (m.estado_pago) {
    case 'paid': return { texto: 'Pagado', tono: 'ok' }
    case 'refunded': return { texto: 'Reembolsado', tono: 'muted' }
    case 'parcial': return { texto: 'Pago parcial', tono: 'warn', detalle: `Falta ${m.saldo}` }
    default: return { texto: 'Sin pago', tono: 'bad' }
  }
}

// Por qué (o por qué no) se puede surtir. NUNCA dice "pagado" por un crédito.
export function etiquetaLiberacion(m: Pick<OrderMoney, 'liberado' | 'credito_autorizado' | 'due_date' | 'vencido' | 'estado_pago' | 'saldo'>): EtiquetaPago {
  if (!m.liberado) return { texto: 'No liberado', tono: 'bad', detalle: 'Registra el cobro o pide crédito a Dirección' }
  if (m.estado_pago === 'paid' && !m.credito_autorizado) return { texto: 'Liberado por cobro', tono: 'ok' }
  if (m.credito_autorizado) {
    return m.vencido
      ? { texto: 'Crédito VENCIDO', tono: 'bad', detalle: `Venció el ${fecha(m.due_date)} · debe ${m.saldo}` }
      : { texto: 'Crédito autorizado', tono: 'warn', detalle: `Vence ${fecha(m.due_date)} · debe ${m.saldo}` }
  }
  return { texto: 'Liberado por cobro', tono: 'ok' }
}

// ¿Se le debe dinero al cliente y todavía no ha salido de la caja?
export const reembolsoPendiente = (m: Pick<OrderMoney, 'reembolso_pendiente'>): boolean => m.reembolso_pendiente > 0.0001

// Cuentas por cobrar: saldo > 0 y el pedido no está cancelado.
export const esPorCobrar = (m: Pick<OrderMoney, 'saldo' | 'order_status'>): boolean =>
  m.saldo > 0.0001 && m.order_status !== 'cancelled'

// Antigüedad del saldo para el aging de cobranza (días desde el vencimiento del crédito;
// sin crédito, la deuda es exigible desde el primer día).
export function diasVencido(m: Pick<OrderMoney, 'credito_autorizado' | 'due_date'>, hoy: string): number {
  if (!m.credito_autorizado || !m.due_date) return 0
  const ms = Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${m.due_date.slice(0, 10)}T00:00:00Z`)
  return Math.max(0, Math.round(ms / 86400000))
}

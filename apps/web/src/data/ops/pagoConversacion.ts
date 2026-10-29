// PAGO-DESDE-CONVERSACIÓN (mig 20270210) · el vendedor trabaja el dinero de SU cliente sin que éste entre al portal: ve sus
// pedidos con saldo, reporta el pago con la foto del comprobante que el cliente mandó por el chat (queda en revisión para
// Dirección: reportar ≠ cobrar) y, ya validado, le manda el recibo por la misma conversación.
import { hasSupabase, supabase } from '../../lib/supabase'
import { money } from '../../lib/format'

export type MetodoPago = 'transferencia' | 'efectivo' | 'tarjeta' | 'otro'
export interface PedidoCliente {
  id: string; folio: string | null; fecha: string; total: number; estado: string
  saldo: number; cobrado: number; estado_pago: string | null; en_revision: boolean
  ultimo_pago: { monto: number; fecha: string; metodo: string } | null
}
export type Res<T> = { ok: true; data: T } | { ok: false; mensaje: string }

export function mensajePago(t: string | undefined): string {
  const m = t ?? ''
  if (/NO_AUTORIZADO/.test(m)) return 'Solo Dirección o el vendedor de este cliente pueden reportar sus pagos.'
  if (/ADJUNTO_NO_ES_DEL_CLIENTE/.test(m)) return 'El comprobante tiene que ser una foto que el cliente mandó en esta conversación.'
  return m || 'No se pudo completar. Intenta de nuevo.'
}

export interface ClientePagos {
  pedidos(conv: string): Promise<Res<PedidoCliente[]>>
  reportar(a: { orderId: string; adjuntoId: string; amount: number; method: MetodoPago; reference?: string; opId: string }): Promise<Res<{ status: string }>>
}

export const pagosConversacion: ClientePagos = {
  async pedidos(conv) {
    if (!hasSupabase) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
    try {
      const { data, error } = await supabase.rpc('cc_cliente_pedidos' as never, { p_conv: conv } as never)
      if (error) return { ok: false, mensaje: mensajePago((error as { message?: string }).message) }
      return { ok: true, data: (data ?? []) as unknown as PedidoCliente[] }
    } catch { return { ok: false, mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } }
  },
  async reportar(a) {
    if (!hasSupabase) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
    try {
      const { data, error } = await supabase.functions.invoke('report-transfer', {
        body: { orderId: a.orderId, adjuntoId: a.adjuntoId, amount: a.amount, method: a.method, reference: a.reference || undefined, opId: a.opId },
      })
      if (error) {
        let texto = 'No se pudo reportar el pago. Intenta de nuevo.'
        try { const b = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.(); if (b?.error) texto = mensajePago(b.error) } catch { /* sin cuerpo */ }
        return { ok: false, mensaje: texto }
      }
      return { ok: true, data: { status: (data as { status?: string } | null)?.status ?? 'applied' } }
    } catch { return { ok: false, mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } }
  },
}

const METODO: Record<string, string> = { transferencia: 'transferencia', efectivo: 'efectivo', tarjeta: 'tarjeta', stripe: 'tarjeta', otro: 'pago' }
const fechaCorta = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

/** Recibo para mandar por la conversación, con lo que el libro ya registró (nunca con lo solo reportado). */
export function textoRecibo(p: PedidoCliente, nombre?: string): string | null {
  if (!p.ultimo_pago) return null
  const folio = p.folio ?? 'tu pedido'
  const partes = [`${nombre ? `Hola ${nombre}, ` : ''}recibimos tu pago de ${money(p.ultimo_pago.monto)} por ${METODO[p.ultimo_pago.metodo] ?? 'pago'} (${fechaCorta(p.ultimo_pago.fecha)}) del pedido ${folio}.`]
  partes.push(p.saldo > 0 ? `Saldo pendiente: ${money(p.saldo)}.` : 'Tu pedido quedó pagado por completo.')
  partes.push('¡Gracias por tu compra!')
  return partes.join(' ')
}

/** Estado del dinero del pedido tal como lo ve el vendedor. */
export function estadoPedidoPago(p: PedidoCliente): { tono: 'ok' | 'warn' | 'neu'; texto: string } {
  if (p.en_revision) return { tono: 'neu', texto: 'Pago en revisión' }
  if (p.saldo <= 0) return { tono: 'ok', texto: 'Pagado' }
  if (p.cobrado > 0) return { tono: 'warn', texto: `Debe ${money(p.saldo)}` }
  return { tono: 'warn', texto: 'Por pagar' }
}

// COTIZACIONES (mig 20270209) · el vendedor cotiza a su cliente desde la conversación o su ficha; se manda por el chat o
// por correo y queda en su expediente. Los precios los pone y congela el servidor (misma regla que un pedido).
import { hasSupabase, supabase } from '../../lib/supabase'
import { money } from '../../lib/format'

export interface LineaCotizacion { product_id: string; nombre: string; sku: string | null; qty: number; unit_price: number; precio_lista: number; subtotal: number }
export interface Cotizacion {
  id: string; folio: string; customer_id: string; conversation_id: string | null; seller_profile_id: string | null
  estado: 'enviada' | 'convertida' | 'cancelada'; vigente_hasta: string; lineas: LineaCotizacion[]; subtotal: number; total: number
  notas: string | null; order_id: string | null; enviada_chat_at: string | null; enviada_correo_at: string | null; created_at: string
}
export type Res<T> = { ok: true; data: T } | { ok: false; mensaje: string }

export function mensajeCotizacion(t: string | undefined): string {
  const m = t ?? ''
  if (/NO_AUTORIZADO/.test(m)) return 'Solo Dirección o el vendedor de este cliente pueden cotizarle.'
  if (/PRODUCTO_NO_DISPONIBLE/.test(m)) return 'Uno de los productos ya no está disponible: quítalo y vuelve a intentar.'
  if (/LINEAS_INVALIDAS/.test(m)) return 'Revisa los productos y las cantidades.'
  if (/SIN_CORREO/.test(m)) return 'Este cliente no tiene correo en su ficha: mándasela por el chat.'
  if (/COTIZACION_NO_VIGENTE/.test(m)) return 'Esta cotización ya no está vigente (venció, se convirtió en pedido o se canceló).'
  if (/CLIENTE_INACTIVO/.test(m)) return 'Este cliente está dado de baja.'
  return 'No se pudo completar. Intenta de nuevo.'
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<Res<T>> {
  if (!hasSupabase) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
  try {
    const { data, error } = await supabase.rpc(fn as never, args as never)
    if (error) return { ok: false, mensaje: mensajeCotizacion((error as { message?: string }).message) }
    return { ok: true, data: data as T }
  } catch { return { ok: false, mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } }
}

export const cotizaciones = {
  crear: (customer: string, lineas: Array<{ product_id: string; qty: number }>, notas?: string, conversation?: string | null) =>
    rpc<Cotizacion>('cc_cotizacion_crear', { p_customer: customer, p_lineas: lineas, p_notas: notas || null, p_conversation: conversation ?? null }),
  enviar: (id: string, via: 'chat' | 'correo') => rpc<{ via: string; para?: string }>('cc_cotizacion_enviar', { p_cot: id, p_via: via }),
  convertida: (id: string, order: string) => rpc<{ idempotente: boolean }>('cc_cotizacion_convertida', { p_cot: id, p_order: order }),
  cancelar: (id: string) => rpc<{ idempotente: boolean }>('cc_cotizacion_cancelar', { p_cot: id }),
  async deCliente(customer: string): Promise<Res<Cotizacion[]>> {
    if (!hasSupabase) return { ok: true, data: [] }
    const { data, error } = await supabase.from('cotizaciones' as never).select('*').eq('customer_id', customer).order('created_at', { ascending: false }).limit(10)
    return error ? { ok: false, mensaje: mensajeCotizacion(error.message) } : { ok: true, data: (data ?? []) as unknown as Cotizacion[] }
  },
}
export type ClienteCotizaciones = typeof cotizaciones

/** "Vencida" no se guarda: se deduce por fecha. */
export const estadoVisible = (c: Pick<Cotizacion, 'estado' | 'vigente_hasta'>, ahora = Date.now()): 'vigente' | 'vencida' | 'convertida' | 'cancelada' =>
  c.estado === 'enviada' ? (Date.parse(c.vigente_hasta) < ahora ? 'vencida' : 'vigente') : c.estado

const fechaLarga = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'America/Mazatlan' })
/** Texto para mandar por WhatsApp/chat: renglones, total, vigencia y la pregunta para cerrar. */
export function textoCotizacion(c: Pick<Cotizacion, 'folio' | 'lineas' | 'total' | 'vigente_hasta' | 'notas'>, nombre?: string): string {
  return [
    `${nombre ? `${nombre}, te` : 'Te'} comparto tu cotización ${c.folio} de Renovacell:`,
    ...c.lineas.map((l) => `• ${l.qty} × ${l.nombre} — ${money(l.subtotal)}`),
    `Total: ${money(c.total)} MXN`,
    `Vigente hasta el ${fechaLarga(c.vigente_hasta)}. El envío se confirma al hacer tu pedido.`,
    ...(c.notas ? [c.notas] : []),
    '¿Te la confirmo como pedido?',
  ].join('\n')
}

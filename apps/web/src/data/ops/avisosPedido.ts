// AVISOS DEL PEDIDO, A LA VISTA (27 nov 2026, dueño: «sí les llegan los mensajes por WhatsApp; lo que se me hace raro es
// que en el sistema no hay manera de ver que se envió eso»). Cada pedido manda avisos al cliente por correo y por
// WhatsApp (recibido, pago confirmado, va en camino, entregado); aquí se leen para enseñarlos en la venta.
// Solo lectura: la base decide quién los ve (el mismo personal que ya ve ese pedido).
import { hasSupabase, supabase } from '../../lib/supabase'

export type CanalAviso = 'whatsapp' | 'correo'
export interface AvisoPedido { canal: CanalAviso; aviso: string; estado: string; cuando: string; destino: string | null; respondio: boolean; detalle: string | null }

const NOMBRE_AVISO: Record<string, string> = {
  pedido_recibido: 'Pedido recibido', pago_recibido: 'Pago confirmado', pedido_enviado: 'Va en camino', pedido_entregado: 'Entregado',
  pedido_cancelado: 'Pedido cancelado', reembolso_realizado: 'Reembolso hecho', link_pago: 'Link de pago', cotizacion: 'Cotización',
}
/** «pedido_recibido» → «Pedido recibido». Un aviso que no se conoce se muestra legible, nunca con guiones bajos. */
export function nombreAviso(clave: string): string {
  if (NOMBRE_AVISO[clave]) return NOMBRE_AVISO[clave]
  const t = clave.replace(/_/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Aviso'
}
export const NOMBRE_CANAL: Record<CanalAviso, string> = { whatsapp: 'WhatsApp', correo: 'Correo' }

export type TonoAviso = 'ok' | 'espera' | 'no'
/** Qué pasó con el aviso, en palabras: salió, está en cola, o no salió y por qué. */
export function estadoAviso(a: Pick<AvisoPedido, 'canal' | 'estado' | 'detalle'>): { tono: TonoAviso; texto: string } {
  switch (a.estado) {
    case 'enviado': return { tono: 'ok', texto: 'Enviado' }
    case 'pendiente': case 'enviando': return { tono: 'espera', texto: 'En cola, sale en unos minutos' }
    case 'sin_destinatario': return { tono: 'no', texto: a.canal === 'correo' ? 'No se envió: el cliente no tiene correo' : 'No se envió: el cliente no tiene celular' }
    case 'omitido': return { tono: 'no', texto: `No se envió${a.detalle ? `: ${a.detalle}` : ''}` }
    case 'incierto': return { tono: 'no', texto: 'No se sabe si salió' }
    case 'fallido': return { tono: 'no', texto: 'No se pudo enviar' }
    default: return { tono: 'espera', texto: a.estado || 'Sin dato' }
  }
}

/** Resumen de una línea: «4 enviados (2 por WhatsApp, 2 por correo) · 1 no salió». Vacío si no hay avisos. */
export function resumenAvisos(avisos: AvisoPedido[]): string {
  if (avisos.length === 0) return ''
  const env = avisos.filter((a) => a.estado === 'enviado')
  const wa = env.filter((a) => a.canal === 'whatsapp').length; const co = env.length - wa
  const no = avisos.filter((a) => estadoAviso(a).tono === 'no').length
  const partes: string[] = []
  if (env.length) partes.push(`${env.length} ${env.length === 1 ? 'enviado' : 'enviados'} (${[wa ? `${wa} por WhatsApp` : '', co ? `${co} por correo` : ''].filter(Boolean).join(', ')})`)
  if (no) partes.push(`${no} no ${no === 1 ? 'salió' : 'salieron'}`)
  const cola = avisos.length - env.length - no
  if (cola) partes.push(`${cola} en cola`)
  return partes.join(' · ')
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
/** Los avisos de un pedido, del más viejo al más nuevo. `null` = no se pudo leer (se dice; no se inventa «sin avisos»). */
export async function leerAvisosDelPedido(orderId: string, rpc: Rpc = rpcPorDefecto): Promise<AvisoPedido[] | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return []
  try {
    const { data, error } = await rpc('avisos_del_pedido', { p_order: orderId })
    if (error || !Array.isArray(data)) return null
    return (data as Array<Record<string, unknown>>)
      .filter((x) => x && (x.canal === 'whatsapp' || x.canal === 'correo') && typeof x.cuando === 'string')
      .map((x) => ({ canal: x.canal as CanalAviso, aviso: String(x.aviso ?? ''), estado: String(x.estado ?? ''), cuando: x.cuando as string, destino: texto(x.destino), respondio: x.respondio === true, detalle: texto(x.detalle) }))
  } catch { return null }
}

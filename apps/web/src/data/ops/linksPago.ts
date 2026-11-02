// LINK DE PAGO CON TARJETA (2 nov 2026) · Renovacell saca el link a mano en la app de BanBajío. El cliente lo pide (portal,
// WhatsApp o su vendedor), el vendedor lo pega aquí y el sistema se lo entrega; Dirección/Facturación lo marcan pagado.
import { supabase } from '../../lib/supabase'

export type EstadoLink = 'solicitado' | 'enviado' | 'pagado' | 'cancelado'
export interface LinkPago {
  id: string; order_id: string; folio: string | null; estado: EstadoLink; monto: number; via: 'portal' | 'whatsapp' | 'personal'
  url: string | null; dominio: string | null; banbajio: boolean | null; created_at: string; enviado_at: string | null; pagado_at: string | null
  referencia: string | null; cliente?: string | null; vendedor?: string | null; es_mio?: boolean; url_guardada?: string | null
}
type Res<T> = { ok: true; data: T } | { ok: false; error: string }

const MENSAJES: Array<[RegExp, string]> = [
  [/LINK_INVALIDO/, 'Pega el link completo, el que empieza con https://.'],
  [/SIN_SALDO/, 'Ese pedido ya no tiene saldo por cobrar.'],
  [/PEDIDO_CANCELADO/, 'Ese pedido está cancelado.'],
  [/LINK_NO_ACTIVO|LINK_NO_ENVIADO/, 'Esa solicitud ya no está activa. Actualiza la lista.'],
  [/NO_AUTORIZADO|insufficient/i, 'No tienes permiso para hacer esto.'],
]
const mensaje = (m?: string) => MENSAJES.find(([r]) => r.test(m ?? ''))?.[1] ?? 'No se pudo completar. Intenta de nuevo.'
const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<Res<T>> => {
  const { data, error } = await supabase.rpc(fn as never, args as never)
  return error ? { ok: false, error: mensaje(error.message) } : { ok: true, data: data as T }
}

export const linksPago = {
  lista: () => rpc<LinkPago[]>('links_pago_lista', {}),
  solicitar: (order: string) => rpc<LinkPago>('link_pago_solicitar', { p_order: order }),
  dePedido: (order: string) => rpc<LinkPago | null>('link_pago_de_pedido', { p_order: order }),
  enviar: (id: string, url: string) => rpc<LinkPago & { whatsapp: boolean }>('link_pago_enviar', { p_link: id, p_url: url }),
  cancelar: (id: string, motivo: string | null) => rpc<LinkPago>('link_pago_cancelar', { p_link: id, p_motivo: motivo }),
  pagado: (id: string, referencia: string | null) => rpc<LinkPago>('link_pago_pagado', { p_link: id, p_referencia: referencia }),
}
export type ClienteLinksPago = typeof linksPago

/** Dominio de un link pegado (para mostrarlo antes de enviarlo); null si no es https. */
export function dominioDe(url: string): string | null {
  const m = /^https:\/\/([^/:?#\s]+)/i.exec(url.trim())
  return m ? m[1].toLowerCase() : null
}
export const esBanBajio = (dominio: string | null) => !!dominio && /(bajio|bb\.com\.mx)/.test(dominio)

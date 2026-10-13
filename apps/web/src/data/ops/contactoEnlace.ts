// CX-ENLACE · Lo que el personal necesita del enlace de contacto: la dirección que se comparte y los datos que dejó
// quien escribe por él (comando `cc_contacto_de`: solo Dirección o el asesor asignado a ESA conversación).
import { hasSupabase, supabase } from '../../lib/supabase'

export interface ContactoEnlace {
  nombre: string; telefono: string; email: string; es_medico: boolean; cedula: string | null
  posible_cliente: string | null     // coincide con un cliente por correo o celular: NO está confirmado hasta que inicie sesión
  confirmado: boolean                // la conversación ya pertenece a una cuenta
}

/** La dirección única que se comparte. En producción siempre la del dominio público (ahí viven la landing y el registro). */
export function urlEnlaceContacto(loc: { hostname: string; origin: string } = window.location): string {
  return /(^|\.)renovacell\.mx$/i.test(loc.hostname) ? 'https://renovacell.mx/contacto' : `${loc.origin}/contacto`
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

/** null = esa conversación no viene del enlace (o no te corresponde verla). Nunca lanza. */
export async function contactoDe(conversationId: string, rpc: Rpc = rpcPorDefecto): Promise<ContactoEnlace | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return null
  try {
    const { data, error } = await rpc('cc_contacto_de', { p_conv: conversationId })
    if (error || !data || typeof data !== 'object') return null
    const d = data as Partial<ContactoEnlace>
    if (typeof d.nombre !== 'string' || typeof d.telefono !== 'string' || typeof d.email !== 'string') return null
    return { nombre: d.nombre, telefono: d.telefono, email: d.email, es_medico: d.es_medico === true, cedula: typeof d.cedula === 'string' ? d.cedula : null,
      posible_cliente: typeof d.posible_cliente === 'string' ? d.posible_cliente : null, confirmado: d.confirmado === true }
  } catch { return null }
}

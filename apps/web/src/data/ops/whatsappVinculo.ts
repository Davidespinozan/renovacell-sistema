// IA MEJOR QUE EL HUMANO · E · el doctor conecta SU WhatsApp con un código (lo pide con su sesión y lo manda desde su
// WhatsApp); así la asesora lo reconoce ahí con sus precios y pedidos. La base decide todo (wa_vinculo_*).
import { supabase } from '../../lib/supabase'

export interface CodigoVinculo { codigo: string; expira_at: string; numero: string; enlace: string }
export interface EstadoVinculo { vinculado: boolean; numero?: string; desde?: string; via?: 'codigo' | 'personal' }
type Res<T> = { ok: true; data: T } | { ok: false; error: string }
const rpc = async <T>(fn: string): Promise<Res<T>> => {
  const { data, error } = await supabase.rpc(fn as never)
  if (error) return { ok: false, error: /NO_AUTORIZADO/.test(error.message) ? 'Disponible cuando tu cuenta esté verificada.' : 'No se pudo completar. Intenta de nuevo.' }
  return { ok: true, data: data as T }
}
export const whatsappVinculo = {
  estado: () => rpc<EstadoVinculo>('wa_vinculo_estado'),
  codigo: () => rpc<CodigoVinculo>('wa_vinculo_codigo'),
  quitar: () => rpc<{ quitados: number }>('wa_vinculo_quitar'),
}
export type ClienteWhatsappVinculo = typeof whatsappVinculo

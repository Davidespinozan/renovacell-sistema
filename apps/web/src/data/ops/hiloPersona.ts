// HILO POR PERSONA (14 nov 2026) · las demás conversaciones abiertas de la MISMA persona (WhatsApp, Instagram, Facebook,
// portal) y sus mensajes recientes, para que el personal vea UN historial con el canal de cada mensaje y elija por cuál
// responder. Solo lectura; la base decide quién puede verlo (cc_hilo_persona).
import { hasSupabase, supabase } from '../../lib/supabase'
import type { Mensaje } from './chat'

export type CanalPersona = 'whatsapp' | 'instagram' | 'messenger' | 'portal'
export interface ConvPersona { conversation_id: string; canal: CanalPersona; modo: string; last_message_at: string | null; actual: boolean }
export interface MensajeOtroCanal extends Mensaje { conversation_id: string; canal: CanalPersona }
export interface HiloPersona { persona: string | null; conversaciones: ConvPersona[]; mensajes: MensajeOtroCanal[] }
export const NOMBRE_CANAL_PERSONA: Record<CanalPersona, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Facebook', portal: 'Portal' }

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

/** null = no se pudo (sin acceso o sin red): el chat sigue con su propia conversación. */
export async function hiloPersona(conversationId: string, rpc: Rpc = rpcPorDefecto): Promise<HiloPersona | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return null
  try {
    // 15 nov 2026 · por la Edge `chat`: la misma lectura, pero con los enlaces a las fotos, audios y archivos de los otros
    // canales (directo de la base solo llegaba el texto "Envió una imagen"). Si la Edge no responde, la lectura directa.
    if (rpc === rpcPorDefecto) {
      const { data, error } = await supabase.functions.invoke('chat', { body: { action: 'hilo_persona', conversation_id: conversationId } })
      if (!error && data && Array.isArray((data as HiloPersona).mensajes)) {
        const d = data as HiloPersona
        return { persona: d.persona ?? null, conversaciones: d.conversaciones ?? [], mensajes: d.mensajes ?? [] }
      }
    }
    const { data, error } = await rpc('cc_hilo_persona', { p_conv: conversationId })
    if (error || !data) return null
    const d = data as HiloPersona
    return { persona: d.persona ?? null, conversaciones: d.conversaciones ?? [], mensajes: d.mensajes ?? [] }
  } catch { return null }
}

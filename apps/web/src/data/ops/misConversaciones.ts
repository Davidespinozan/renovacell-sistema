// MIS CLIENTES Y PROSPECTOS (mig 20270325) · las conversaciones de mi cartera o que atendí, aunque hoy las atienda la IA,
// y retomarlas yo misma (asignar + iniciar en un paso). La base decide de quién es cada conversación.
import { hasSupabase, supabase } from '../../lib/supabase'

export interface MiConversacion {
  conversation_id: string; dueno: string; modo: string; last_message_at: string | null; prospecto: boolean; canal: 'whatsapp' | null
  atiende: 'ia' | 'otro' | 'direccion' | 'nadie'; atiende_nombre: string | null; puede_retomar: boolean
  ultimo: { actor: string; texto: string; at: string } | null
}
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

/** null = no se pudo cargar. */
export async function misConversaciones(rpc: Rpc = rpcPorDefecto): Promise<MiConversacion[] | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return []
  try { const { data, error } = await rpc('cc_mis_conversaciones'); return error ? null : Array.isArray(data) ? data as MiConversacion[] : [] } catch { return null }
}

export async function retomarConversacion(id: string, rpc: Rpc = rpcPorDefecto): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  try {
    const { error } = await rpc('cc_retomar_conversacion', { p_conv: id })
    if (!error) return { ok: true }
    const m = error.message ?? ''
    const por = /ATENDIDA_POR_OTRO: ?(.*)/.exec(m)
    return { ok: false, mensaje: por ? `No se puede retomar: ${por[1]}.` : /NO_AUTORIZADO/.test(m) ? 'Esa conversación ya no es de tu cartera.' : /CONVERSACION_CERRADA/.test(m) ? 'La conversación ya se cerró.' : 'No se pudo retomar. Intenta de nuevo.' }
  } catch { return { ok: false, mensaje: 'Sin conexión con el servidor.' } }
}

export const QUIEN_ATIENDE: Record<MiConversacion['atiende'], string> = { ia: 'La atiende el asistente', otro: 'La atiende otra persona', direccion: 'La atiende Dirección', nadie: 'Sin atender' }

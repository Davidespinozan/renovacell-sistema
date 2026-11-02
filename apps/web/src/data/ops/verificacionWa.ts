// VERIFICACIÓN POR WHATSAPP (2 nov 2026) · la IA juntó en el chat los datos del profesional; el responsable comercial o
// Dirección la aprueba con un toque (Edge alta-whatsapp: ficha + cuenta verificada + vínculo del WhatsApp) o la rechaza.
import { supabase } from '../../lib/supabase'

export interface SolicitudAlta {
  id: string; estado: 'pendiente' | 'aprobada' | 'rechazada'; nombre: string; cedula: string; email: string
  especialidad: string | null; ciudad: string | null; adjuntos: string[]; created_at: string; motivo: string | null; posible_cliente: boolean
}
type Res<T> = { ok: true; data: T } | { ok: false; error: string }
export const verificacionWa = {
  async de(conv: string): Promise<Res<SolicitudAlta | null>> {
    const { data, error } = await supabase.rpc('cc_solicitud_alta_de' as never, { p_conv: conv } as never)
    return error ? { ok: false, error: 'No se pudo leer la solicitud.' } : { ok: true, data: (data as SolicitudAlta | null) ?? null }
  },
  async aprobar(id: string): Promise<Res<{ ok: boolean }>> {
    const { data, error } = await supabase.functions.invoke('alta-whatsapp', { body: { solicitud_id: id } })
    if (error) {
      const cuerpo = await (error as { context?: Response }).context?.json?.().catch(() => null) as { message?: string } | null
      return { ok: false, error: cuerpo?.message ?? 'No se pudo aprobar.' }
    }
    return { ok: true, data: data as { ok: boolean } }
  },
  async rechazar(id: string, motivo: string): Promise<Res<null>> {
    const { error } = await supabase.rpc('cc_solicitud_alta_rechazar' as never, { p_solicitud: id, p_motivo: motivo } as never)
    return error ? { ok: false, error: 'No se pudo rechazar.' } : { ok: true, data: null }
  },
}
export type ClienteVerificacionWa = typeof verificacionWa

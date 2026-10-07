// Commercial Intent · CI-3 · Realtime como DESPERTADOR del detector C4 (nunca autoridad). Un INSERT en
// cc_messages de la conversación propia solo provoca una lectura canónica (`leer`) en el lanzador: el contenido
// del aviso se IGNORA. Autorización: el RLS de cc_messages (dueño, vendedor actual o Dirección) aplicado por
// Realtime con el JWT del usuario (migración 129). Sin backend o sin sesión no hay canal: queda el sondeo de 30 s.
import { hasSupabase, supabase } from '../../lib/supabase'

export type EstadoCanal = 'listo' | 'caido'
/** Se suscribe a los mensajes nuevos de UNA conversación; devuelve la función que la retira. */
export type Suscriptor = (conversationId: string, alAvisar: () => void, alEstado?: (e: EstadoCanal) => void) => () => void

export const suscribirMensajes: Suscriptor = (conversationId, alAvisar, alEstado) => {
  if (!hasSupabase || typeof supabase?.channel !== 'function') return () => {}
  let canal: ReturnType<typeof supabase.channel> | null = null
  let vivo = true
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!vivo || !token) return                       // sin sesión (p. ej. tras cerrar sesión): sin canal
      supabase.realtime.setAuth(token)                  // sin el token del usuario el RLS lo filtraría todo
      canal = supabase.channel(`rc-chat-${conversationId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cc_messages', filter: `conversation_id=eq.${conversationId}` }, () => alAvisar())
        .subscribe((estado) => {
          if (estado === 'SUBSCRIBED') alEstado?.('listo')
          else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') alEstado?.('caido')
        })
      if (!vivo && canal) { void supabase.removeChannel(canal); canal = null }
    } catch { /* sin Realtime: el sondeo de 30 s sigue siendo la red de seguridad */ }
  })()
  return () => { vivo = false; if (canal) { void supabase.removeChannel(canal); canal = null } }
}

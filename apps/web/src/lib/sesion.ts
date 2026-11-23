// Filtro de eventos de sesión para los stores (ver comentario abajo). Módulo propio para que las
// pruebas que simulan lib/supabase sigan funcionando sin declarar esta función.
import { supabase } from './supabase'

// PERF: supabase-js emite SIGNED_IN cada vez que la pestaña vuelve a estar visible y
// TOKEN_REFRESHED cada hora; reaccionar a ambos re-descargaba la base entera al cambiar de
// pestaña. Este filtro avisa 'cambio' solo cuando cambia el usuario (entrada, salida, otra
// cuenta) y 'refresco' a lo más cada REFRESCO_MIN_MS, para no servir datos de hace horas.
export type EventoSesion = 'cambio' | 'refresco'
export const REFRESCO_MIN_MS = 5 * 60_000
// DUEÑO COMO VENDEDOR · al entrar/salir de «Ventas» los datos se recargan como si cambiara la sesión (lo cargado como
// Dirección no es lo que ve un vendedor, y al revés).
const oyentes = new Set<() => void>()
export function avisarCambioDeRol(): void { oyentes.forEach((f) => { try { f() } catch { /* cada store se recupera solo */ } }) }
export function alCambiarSesion(cb: (e: EventoSesion, uid: string | null) => void): void {
  let ultimo: string | null | undefined
  let ultimoAviso = 0
  oyentes.add(() => cb('cambio', ultimo ?? null))
  supabase.auth?.onAuthStateChange?.((ev, session) => {
    const uid = session?.user?.id ?? null
    if (uid !== ultimo) { ultimo = uid; ultimoAviso = Date.now(); cb('cambio', uid); return }
    if ((ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED') && uid && Date.now() - ultimoAviso >= REFRESCO_MIN_MS) {
      ultimoAviso = Date.now(); cb('refresco', uid)
    }
  })
}

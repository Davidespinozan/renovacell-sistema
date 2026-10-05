// W6-A1 · Qué hace el navegador cuando el servidor dice CUENTA_SUSPENDIDA.
//
// La autoridad es del servidor: desde el instante en que Dirección suspende a alguien,
// la base y las Edge Functions le niegan todo. Lo que falta es que la pestaña abierta se
// entere: cualquier respuesta con `CUENTA_SUSPENDIDA` cierra la sesión y deja el motivo
// para que la pantalla de entrada lo muestre. No se promete nada más (un token vigente
// expira solo); no hace falta: ya no tiene autoridad en ningún lado.
import { supabase, hasSupabase } from '../lib/supabase'

export const CUENTA_SUSPENDIDA_MSG = 'Tu acceso fue suspendido por Dirección. Si crees que es un error, contáctala.'

const LLAVE = 'renovacell.cierre_sesion'
let cerrando = false

export const esSuspension = (mensaje: string | null | undefined): boolean => /CUENTA_SUSPENDIDA/.test(mensaje ?? '')

/** Cierra la sesión por suspensión (una sola vez) y deja el motivo para la entrada. */
export async function cerrarSesionPorSuspension(): Promise<void> {
  if (cerrando) return
  cerrando = true
  try { sessionStorage.setItem(LLAVE, CUENTA_SUSPENDIDA_MSG) } catch { /* sin almacenamiento: solo se cierra */ }
  try { if (hasSupabase) await supabase.auth.signOut() } catch { /* el servidor ya niega todo; el cierre local basta */ }
  cerrando = false
}

/** Si una respuesta del servidor dice CUENTA_SUSPENDIDA, cierra la sesión. Devuelve si lo era. */
export function atenderSuspension(mensaje: string | null | undefined): boolean {
  if (!esSuspension(mensaje)) return false
  void cerrarSesionPorSuspension()
  return true
}

/** Motivo pendiente de mostrar en la pantalla de entrada (se consume al leerlo). */
export function motivoCierreSesion(): string | null {
  try {
    const m = sessionStorage.getItem(LLAVE)
    if (m) sessionStorage.removeItem(LLAVE)
    return m
  } catch { return null }
}

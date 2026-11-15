// DIAGNÓSTICO DE SESIÓN (15 nov 2026, equipo: "nos está sacando de la sesión"). Cada salida que la persona NO pidió se
// anota en el dispositivo (sin red no se puede mandar) y se sube a la base en cuanto vuelve a entrar.
import { supabase } from '../lib/supabase'

const CLAVE = 'rc_diag_sesion'
const MAX = 20
type Evento = { evento: string; detalle?: string; at: string; dispositivo?: string }

const dispositivo = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent).slice(0, 200)
function leer(): Evento[] { try { const v = JSON.parse(localStorage.getItem(CLAVE) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }

/** Anota un evento (los últimos 20). Nunca falla. */
export function anotarSalida(evento: string, detalle?: string) {
  try {
    const lista = [...leer(), { evento, detalle: detalle?.slice(0, 300), at: new Date().toISOString(), dispositivo: dispositivo() }].slice(-MAX)
    localStorage.setItem(CLAVE, JSON.stringify(lista))
  } catch { /* sin almacenamiento */ }
}

/** Ya con sesión: sube lo anotado y lo borra del dispositivo. Si falla, se queda para la próxima. */
export async function subirDiagnostico(rpc: (fn: string, a: Record<string, unknown>) => PromiseLike<{ error: unknown }> = (fn, a) => supabase.rpc(fn as never, a as never) as never) {
  const lista = leer()
  if (!lista.length) return
  try {
    const { error } = await rpc('sesion_diagnostico_registrar', { p_eventos: lista })
    if (!error) localStorage.removeItem(CLAVE)
  } catch { /* se reintenta al siguiente ingreso */ }
}

// La persona pidió salir: el SIGNED_OUT que sigue no es una falla.
let salidaPedida = false
export const marcarSalidaPedida = () => { salidaPedida = true }
export const fueSalidaPedida = () => { const v = salidaPedida; salidaPedida = false; return v }

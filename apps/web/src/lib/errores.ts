// ALERTAS DE ERRORES (BLOQUE1, 20 nov 2026, dueño: «alertas de errores»). Los errores que ve el equipo se guardan en
// el servidor (registrar_error) AGRUPADOS por huella: el mismo error repetido cuenta, no se duplica. Dirección recibe
// aviso (y push) de cada error NUEVO y cuando uno se repite mucho. Nunca rompe la app y nunca manda datos sensibles
// (pasa por sanitizarTexto). Ruido conocido (extensiones, ResizeObserver, red caída) no se manda.
import { hasSupabase, supabase } from './supabase'
import { sanitizarTexto } from './sanitizar'

export type OrigenError = 'cliente' | 'escritura'
const RUIDO = [/ResizeObserver loop/i, /^Script error\.?$/i, /chrome-extension:|moz-extension:|safari-extension:/i,
  /Failed to fetch|NetworkError|Load failed|network request failed/i, /AbortError|The operation was aborted/i,
  /dynamically imported module|Importing a module script failed|ChunkLoadError/i]
const enviados = new Set<string>()
let enEstaSesion = 0

function ruta(): string { try { return window.location.pathname.slice(0, 120) } catch { return '' } }

export function registrarError(origen: OrigenError, error: unknown, contexto?: string): void {
  try {
    if (!hasSupabase) return
    const crudo = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '')
    if (!crudo.trim() || RUIDO.some((r) => r.test(crudo))) return
    const { texto } = sanitizarTexto((contexto ? `${contexto} · ` : '') + crudo, 280)
    const clave = origen + '|' + texto.replace(/[0-9a-f-]{8,}|\d+/gi, '#')
    if (enviados.has(clave) || enEstaSesion >= 20) return   // por sesión: una vez cada error, máx. 20
    enviados.add(clave); enEstaSesion += 1
    void Promise.resolve(supabase.rpc('registrar_error' as never, { p_origen: origen, p_mensaje: texto, p_ruta: ruta() } as never)).catch(() => {})
  } catch { /* nunca romper la app por la telemetría */ }
}

let instalado = false
export function instalarCapturaErrores(): void {
  if (instalado || typeof window === 'undefined') return
  instalado = true
  window.addEventListener('error', (e) => registrarError('cliente', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => registrarError('cliente', (e as PromiseRejectionEvent).reason))
}

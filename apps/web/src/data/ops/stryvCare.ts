// STRYV Care: mantenimiento e infraestructura del sistema ($2,500 al mes), cobrado por STRYV con la tarjeta de
// Renovacell en la cuenta de Stripe de STRYV. Todo lo decide la Edge `stryv-care`; aquí solo se consulta y se
// redirige a las páginas seguras de Stripe. Mismo diseño que en Fukuroll.
import { supabase, hasSupabase } from '../../lib/supabase'

export type EstadoCare = 'active' | 'trialing' | 'past_due' | 'unpaid' | 'inactivo' | 'no_disponible' | string
export interface ReciboCare { fecha: number; monto_centavos: number; estado: string | null; url: string | null }
export interface StatusCare {
  estado: EstadoCare
  monto_centavos?: number
  puede_activar?: boolean
  proximo_cobro?: number | null
  termina?: number | null
  tarjeta?: { marca: string; last4: string } | null
  recibos?: ReciboCare[]
}
export type ResultadoCare<T> = { ok: true; data: T } | { ok: false; message: string }

async function cuerpoDeError(e: unknown): Promise<{ error?: string } | null> {
  try { return await (e as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.() ?? null } catch { return null }
}
async function llamar<T>(action: 'status' | 'checkout' | 'portal'): Promise<ResultadoCare<T>> {
  if (!hasSupabase) return { ok: true, data: { estado: 'no_disponible' } as unknown as T }
  const { data, error } = await supabase.functions.invoke('stryv-care', { body: { action } })
  if (error) { const b = await cuerpoDeError(error); return { ok: false, message: b?.error ?? 'No pudimos consultar STRYV Care. Intenta de nuevo.' } }
  return { ok: true, data: data as T }
}

export const stryvCare = {
  estado: () => llamar<StatusCare>('status'),
  /** Página segura de Stripe para poner la tarjeta y suscribirse. */
  activar: () => llamar<{ url?: string }>('checkout'),
  /** Portal de Stripe: cambiar tarjeta o descargar recibos. */
  portal: () => llamar<{ url?: string }>('portal'),
}

export const ESTADO_CARE: Record<string, { tono: 'ok' | 'warn' | 'dang' | 'neu'; texto: string }> = {
  active: { tono: 'ok', texto: 'Activo' }, trialing: { tono: 'ok', texto: 'Activo' },
  past_due: { tono: 'warn', texto: 'Pago pendiente' }, unpaid: { tono: 'dang', texto: 'Sin pagar' },
  inactivo: { tono: 'neu', texto: 'Sin activar' },
}
export const fechaCare = (ts?: number | null): string => (ts ? new Date(ts * 1000).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '—')
export const pesosCare = (c?: number): string => `$${((c ?? 0) / 100).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

// Lo que incluye: el mismo plan que en Fukuroll, con los nombres de las piezas de Renovacell.
export const INCLUYE_CARE: readonly string[] = [
  'Sistema operativo, portal del doctor y página pública siempre en línea',
  'Servidores, base de datos, dominio y certificados de seguridad',
  'Respaldos, monitoreo y corrección de fallas',
  'Ajustes de catálogo, precios y fotos',
  'Soporte directo con STRYV',
]

// Al volver de Stripe la URL trae ?care=ok|cancel|volver: se consume una vez y abre esta pantalla.
export function regresoDeStripe(loc: { search: string; pathname: string } = window.location): 'ok' | 'cancel' | 'volver' | null {
  const m = /[?&]care=(ok|cancel|volver)\b/.exec(loc.search)
  return (m?.[1] as 'ok' | 'cancel' | 'volver' | undefined) ?? null
}

export const CLAVE_REGRESO_CARE = 'rc_care_regreso'

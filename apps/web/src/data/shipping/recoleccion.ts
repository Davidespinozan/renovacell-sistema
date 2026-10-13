// PAQ-B · Recolección de paquetería en el cliente. Las reglas son las MISMAS del servidor (Edge `shipping`,
// supabase/functions/shipping/recoleccion.ts): aquí se aplican antes de pedirla para avisar a tiempo; el servidor las
// vuelve a aplicar y la paquetería tiene la última palabra. Neutral al proveedor.
import { hasSupabase, supabase } from '../../lib/supabase'
import type { Shipment } from '../types'
import { diaNegocio, ZONA_NEGOCIO } from '../periodo'

export interface RecoleccionSolicitada { date: string; ready: string; close: string; location: string; instructions?: string }
export interface RecoleccionAgendada extends RecoleccionSolicitada { confirmation: string }

const min = (h: string): number => { const m = /^(\d{2}):(\d{2})$/.exec(h); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : NaN }
const dia = (iso: string): number => Date.parse(iso + 'T00:00:00Z')
export const VENTANA_MINIMA_MIN = 60
export const DIAS_ADELANTE_MAX = 10

export function errorRecoleccion(r: Partial<RecoleccionSolicitada> | null | undefined, hoy: string, ahoraMin: number): string | null {
  const date = String(r?.date ?? ''), ready = String(r?.ready ?? ''), close = String(r?.close ?? '')
  const location = String(r?.location ?? '').trim(), instr = String(r?.instructions ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(dia(date))) return 'Indica la fecha de recolección.'
  const dif = Math.round((dia(date) - dia(hoy)) / 86400000)
  if (dif < 0) return 'La fecha de recolección ya pasó.'
  if (dif > DIAS_ADELANTE_MAX) return `La recolección se agenda con máximo ${DIAS_ADELANTE_MAX} días de anticipación.`
  const a = min(ready), b = min(close)
  if (Number.isNaN(a)) return 'Indica desde qué hora está listo el paquete.'
  if (Number.isNaN(b)) return 'Indica hasta qué hora pueden pasar.'
  if (b - a < VENTANA_MINIMA_MIN) return 'Deja al menos una hora entre "listo desde" y "hasta".'
  if (dif === 0 && a < ahoraMin) return 'La hora de "listo desde" ya pasó; elige una hora posterior o el día siguiente.'
  if (location.length < 2 || location.length > 80) return 'Indica dónde se recoge (por ejemplo: Recepción).'
  if (instr.length > 80) return 'Las instrucciones admiten máximo 80 caracteres.'
  return null
}

// Fecha y hora LOCALES del origen = reloj del negocio (America/Mazatlan, UTC-7 todo el año); el servidor usa el mismo
// desfase. El día sale de la única puerta de fechas (data/periodo.ts).
export function ahoraLocalOrigen(ms: number): { hoy: string; ahoraMin: number } {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA_NEGOCIO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms))
  const [h, m] = hm.split(':').map(Number)
  return { hoy: diaNegocio(ms), ahoraMin: h * 60 + m }
}

// Recolección vigente de un envío (la escribe el servidor en provider_meta.pickup). Sin confirmación ⇒ no hay.
export function recoleccionDe(s: Pick<Shipment, 'pickup_confirmation' | 'provider_meta'>): RecoleccionAgendada | null {
  const conf = (s.pickup_confirmation ?? '').trim()
  if (!conf) return null
  const p = ((s.provider_meta ?? {}) as { pickup?: Partial<RecoleccionAgendada> | null }).pickup ?? {}
  const t = (v: unknown): string => (typeof v === 'string' ? v : '')
  return { confirmation: conf, date: t(p.date), ready: t(p.ready), close: t(p.close), location: t(p.location), ...(t(p.instructions) ? { instructions: t(p.instructions) } : {}) }
}

export type ResultadoRecoleccion = { ok: true; confirmation: string } | { ok: false; error: string; desconocido?: boolean }
type Invocar = (body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (body) => supabase.functions.invoke('shipping', { body }) as Promise<{ data: unknown; error: unknown }>

// El mensaje útil de un rechazo viaja en el cuerpo de la respuesta (context.json()), no en error.message.
async function detalle(error: unknown): Promise<{ message: string; code: string }> {
  try {
    const b = await (error as { context?: { json?: () => Promise<{ message?: string; error?: string }> } })?.context?.json?.()
    return { message: b?.message ?? '', code: b?.error ?? '' }
  } catch { return { message: '', code: '' } }
}

export async function agendarRecoleccion(orderId: string, pickup: RecoleccionSolicitada, invocar: Invocar = invocarPorDefecto): Promise<ResultadoRecoleccion> {
  if (!hasSupabase && invocar === invocarPorDefecto) return { ok: false, error: 'La recolección requiere conexión con el servidor.' }
  try {
    const { data, error } = await invocar({ action: 'schedule_pickup', order_id: orderId, pickup })
    if (error) {
      const d = await detalle(error)
      return { ok: false, error: d.message || 'No se pudo agendar la recolección. Intenta de nuevo.', desconocido: d.code === 'resultado_desconocido' || d.code === 'sin_confirmacion' || d.code === 'no_guardada' }
    }
    const conf = (data as { pickup?: { confirmation?: unknown } } | null)?.pickup?.confirmation
    if (typeof conf !== 'string' || !conf) return { ok: false, error: 'El servidor no devolvió la confirmación de la recolección.' , desconocido: true }
    return { ok: true, confirmation: conf }
  } catch { return { ok: false, error: 'No hay conexión con el servidor. Antes de reintentar, confirma con la paquetería si la recolección quedó agendada.', desconocido: true } }
}

export async function cancelarRecoleccion(orderId: string, reason: string, invocar: Invocar = invocarPorDefecto): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase && invocar === invocarPorDefecto) return { ok: false, error: 'Requiere conexión con el servidor.' }
  try {
    const { data, error } = await invocar({ action: 'cancel_pickup', order_id: orderId, reason })
    if (error) return { ok: false, error: (await detalle(error)).message || 'No se pudo cancelar la recolección.' }
    return (data as { cancelled?: boolean } | null)?.cancelled ? { ok: true } : { ok: false, error: 'El servidor no confirmó la cancelación.' }
  } catch { return { ok: false, error: 'No hay conexión con el servidor. Confirma con la paquetería si quedó cancelada.' } }
}

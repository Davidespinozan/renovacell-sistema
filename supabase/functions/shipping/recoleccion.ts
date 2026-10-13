// ============================================================================
// RECOLECCIÓN (PAQ-B) · reglas NEUTRALES al proveedor para agendar que la paquetería
// pase por un paquete. Módulo PURO (sin red ni Deno): lo prueba vitest y el
// frontend aplica las MISMAS reglas (data/shipping/recoleccion.ts) antes de pedirla.
// El servidor es la autoridad; la paquetería tiene la última palabra (puede rechazar
// una ventana que no atiende).
// ============================================================================
export interface RecoleccionSolicitada { date: string; ready: string; close: string; location: string; instructions?: string }

const min = (h: string): number => { const m = /^(\d{2}):(\d{2})$/.exec(h); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : NaN }
const dia = (iso: string): number => Date.parse(iso + 'T00:00:00Z')

export const VENTANA_MINIMA_MIN = 60     // la paquetería necesita un margen para llegar
export const DIAS_ADELANTE_MAX = 10

// `hoy` = fecha LOCAL del origen (YYYY-MM-DD) y `ahoraMin` = minutos desde medianoche local.
// Devuelve el motivo del rechazo o null.
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

export function limpiarRecoleccion(r: RecoleccionSolicitada): RecoleccionSolicitada {
  const instr = String(r.instructions ?? '').trim()
  return { date: r.date, ready: r.ready, close: r.close, location: r.location.trim(), ...(instr ? { instructions: instr } : {}) }
}

// Fecha y hora LOCALES del origen a partir de un instante (Culiacán: UTC-7 fijo).
export function ahoraLocalOrigen(ms: number, offsetMin = -7 * 60): { hoy: string; ahoraMin: number } {
  const d = new Date(ms + offsetMin * 60000)
  return { hoy: d.toISOString().slice(0, 10), ahoraMin: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

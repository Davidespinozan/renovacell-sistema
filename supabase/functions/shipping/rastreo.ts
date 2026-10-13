// ============================================================================
// RASTREO NEUTRAL AL PROVEEDOR (PAQ-A). Cada paquetería reporta sus eventos con su
// propio vocabulario; aquí se traducen a SEIS estados que entiende el resto del
// sistema (Empaque, Dirección y el cliente). Agregar T1 = escribir su traductor;
// las pantallas, la tabla y el cierre de entrega no cambian.
// Módulo PURO (sin red ni Deno): lo prueba vitest desde el frontend.
// ============================================================================
export type EstadoRastreo = 'sin_eventos' | 'recolectado' | 'en_transito' | 'en_reparto' | 'entregado' | 'incidencia'
export interface EventoRastreo { at: string; code: string; description: string; location?: string }
export interface ResumenRastreo {
  estado: EstadoRastreo
  descripcion: string | null
  firmadoPor: string | null
  entregadoAt: string | null
  eventos: EventoRastreo[]
}

const txt = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()

// ── DHL Express (MyDHL API · GET /shipments/{n}/tracking) ───────────────────
// typeCode de los eventos de DHL → estado neutral. Lista conservadora: lo que no
// se reconoce cuenta como "en tránsito" (nunca como entregado ni como incidencia).
// PENDIENTE: confirmar los códigos contra el sandbox de DHL con una guía real.
const DHL_ENTREGADO = new Set(['OK', 'DL'])
const DHL_EN_REPARTO = new Set(['WC'])
const DHL_RECOLECTADO = new Set(['PU'])
const DHL_INCIDENCIA = new Set(['OH', 'NH', 'BA', 'CA', 'RD', 'RT', 'MS', 'DM', 'UD', 'AD', 'BN', 'CM', 'SS'])

function estadoDeEventoDhl(code: string, description: string): EstadoRastreo {
  const c = code.toUpperCase()
  if (DHL_ENTREGADO.has(c)) return 'entregado'
  if (DHL_EN_REPARTO.has(c)) return 'en_reparto'
  if (DHL_INCIDENCIA.has(c)) return 'incidencia'
  if (DHL_RECOLECTADO.has(c)) return 'recolectado'
  // Sin código reconocible: se intenta por la descripción (inglés o español), solo para los dos casos inequívocos.
  if (!c) {
    if (/^(shipment )?delivered\b|^entregado\b/i.test(description)) return 'entregado'
    if (/with delivery courier|out for delivery|en reparto/i.test(description)) return 'en_reparto'
  }
  return 'en_transito'
}

// Fecha del evento en ISO. MyDHL manda `date` y `time` por separado (hora local del evento) y a veces `GMTOffset`.
// Sin desfase declarado se toma como UTC: el orden entre eventos se conserva; la hora exacta puede variar unas horas.
function fechaEventoDhl(e: Record<string, unknown>): string {
  const ts = txt(e.timestamp)
  if (ts && !Number.isNaN(Date.parse(ts))) return new Date(ts).toISOString()
  const date = txt(e.date), time = txt(e.time) || '00:00:00', off = txt(e.GMTOffset)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const iso = `${date}T${/^\d{2}:\d{2}(:\d{2})?$/.test(time) ? (time.length === 5 ? time + ':00' : time) : '00:00:00'}${/^[+-]\d{2}:\d{2}$/.test(off) ? off : 'Z'}`
  return Number.isNaN(Date.parse(iso)) ? '' : new Date(iso).toISOString()
}

// deno-lint-ignore no-explicit-any
export function resumenDhl(data: any): ResumenRastreo {
  const sh = Array.isArray(data?.shipments) ? data.shipments[0] : data
  const crudos: Record<string, unknown>[] = Array.isArray(sh?.events) ? sh.events : []
  const eventos: Array<EventoRastreo & { firma: string; estado: EstadoRastreo }> = []
  for (const e of crudos) {
    const at = fechaEventoDhl(e)
    if (!at) continue
    const code = txt(e.typeCode ?? e.statusCode).slice(0, 20)
    const description = txt(e.description).slice(0, 300)
    // deno-lint-ignore no-explicit-any
    const area = Array.isArray((e as any).serviceArea) ? (e as any).serviceArea[0] : null
    // deno-lint-ignore no-explicit-any
    const location = (txt(area?.description) || txt((e as any).location?.address?.addressLocality)).slice(0, 160) || undefined
    eventos.push({ at, code, description, location, firma: txt(e.signedBy).slice(0, 120), estado: estadoDeEventoDhl(code, description) })
  }
  eventos.sort((a, b) => a.at.localeCompare(b.at))
  const limpios: EventoRastreo[] = eventos.map(({ at, code, description, location }) => ({ at, code, description, ...(location ? { location } : {}) }))
  if (!eventos.length) return { estado: 'sin_eventos', descripcion: null, firmadoPor: null, entregadoAt: null, eventos: [] }
  // "Entregado" manda aunque después lleguen eventos administrativos; si no, cuenta el evento MÁS RECIENTE.
  const entrega = [...eventos].reverse().find((e) => e.estado === 'entregado')
  const ultimo = eventos[eventos.length - 1]
  const ref = entrega ?? ultimo
  return {
    estado: ref.estado,
    descripcion: ref.description || null,
    firmadoPor: entrega ? (entrega.firma || null) : null,
    entregadoAt: entrega ? entrega.at : null,
    eventos: limpios,
  }
}

// Texto de "quién recibió" para cerrar la entrega con lo que confirmó la paquetería.
export function recibioSegunPaqueteria(r: ResumenRastreo, proveedor: string): string {
  const p = proveedor.toUpperCase()
  return r.firmadoPor ? `${r.firmadoPor} (confirmado por ${p})` : `Entrega confirmada por ${p}`
}

// ¿Hay que volver a consultar a la paquetería? No si ya se entregó; no si se consultó hace poco (salvo forzado).
export const CACHE_RASTREO_MS = 10 * 60 * 1000
export function debeConsultar(prev: { estado?: string | null; synced_at?: string | null } | null, ahora: number, forzar: boolean): boolean {
  if (prev?.estado === 'entregado') return false
  if (forzar) return true
  const t = prev?.synced_at ? Date.parse(prev.synced_at) : NaN
  return Number.isNaN(t) || ahora - t >= CACHE_RASTREO_MS
}

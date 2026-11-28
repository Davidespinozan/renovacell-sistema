// CHOFER EN EL MAPA (21 nov 2026). El celular del chofer manda su ubicación solo mientras está en ruta (la base lo
// revisa) y al entregar; Dirección y Almacén la ven en «Choferes en ruta». Sin Google: GPS del teléfono + OpenStreetMap.
import { hasSupabase, supabase } from '../../lib/supabase'

export interface PuntoMapa { lat: number; lng: number; at?: string; precision?: number | null }
/** DESTINO EN EL MAPA (23 nov 2026) · pin de la dirección: 'entrega' = aprendido de una entrega real (puerta); 'osm' = aproximado. */
export interface DestinoMapa { lat: number; lng: number; fuente: 'entrega' | 'osm'; precision: 'puerta' | 'calle' | 'colonia' | 'cp' }
export interface EntregaMapa { shipment_id: string; folio: string | null; estado: string; cliente: string; entregado_at: string | null; lat: number | null; lng: number | null
  direccion?: string | null; destino?: DestinoMapa | null; distancia_m?: number | null; lejos?: boolean }
export interface ChoferMapa { driver_id: string; nombre: string; ultima: PuntoMapa | null; recorrido: Array<[number, number]>; entregas: EntregaMapa[] }

export interface GpsOficina {
  gps: Array<{ driver_id: string; estado: 'activo' | 'denegado' | 'no_disponible'; desde: string; at: string }>
  sin_ubicacion: Array<{ shipment_id: string; driver_id: string; motivo: string; at: string; folio: string | null }>
}
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export const ubicacionChofer = (rpc: Rpc = rpcPorDefecto) => ({
  /** Nunca lanza: la ubicación es un extra, jamás frena al chofer. */
  registrar: async (p: { lat: number; lng: number; precision?: number | null; tipo?: 'ruta' | 'entrega'; shipmentId?: string | null }): Promise<string> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return 'sin_servidor'
    try {
      const { data, error } = await rpc('chofer_ubicacion_registrar', { p_lat: p.lat, p_lng: p.lng, p_precision: p.precision == null ? null : Math.round(p.precision), p_tipo: p.tipo ?? 'ruta', p_shipment: p.shipmentId ?? null })
      return error ? 'error' : String(data ?? '')
    } catch { return 'error' }
  },
  mapa: async (): Promise<{ ok: true; data: ChoferMapa[] } | { ok: false; error: string }> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return { ok: true, data: [] }
    try {
      const { data, error } = await rpc('choferes_en_mapa')
      if (error) return { ok: false, error: (error.message ?? '').replace(/^[A-Z_]+:\s*/, '') || 'No se pudo cargar el mapa.' }
      const lista = (Array.isArray(data) ? data : []) as ChoferMapa[]
      return { ok: true, data: lista.map((c) => ({ ...c, ultima: c.ultima ? { ...c.ultima, lat: Number(c.ultima.lat), lng: Number(c.ultima.lng) } : null,
        recorrido: (c.recorrido ?? []).map(([a, b]) => [Number(a), Number(b)] as [number, number]),
        entregas: (c.entregas ?? []).map((e) => ({ ...e, lat: e.lat == null ? null : Number(e.lat), lng: e.lng == null ? null : Number(e.lng),
          destino: e.destino ? { ...e.destino, lat: Number(e.destino.lat), lng: Number(e.destino.lng) } : null })) })) }
    } catch { return { ok: false, error: 'Sin conexión.' } }
  },
  /** Pide a la Edge ubicar (OpenStreetMap) las direcciones de entregas vivas que aún no tienen pin. Nunca lanza. */
  geocodificar: async (): Promise<number> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return 0
    try { const { data } = await supabase.functions.invoke('destinos-geocodificar', { body: {} }); return Number((data as { ubicadas?: number } | null)?.ubicadas ?? 0) } catch { return 0 }
  },
  /** GPS EN LA ENTREGA · el teléfono del chofer avisa si su ubicación está activa o bloqueada (la oficina lo ve). Nunca lanza. */
  reportarGps: async (estado: 'activo' | 'denegado' | 'no_disponible'): Promise<void> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return
    try { await rpc('chofer_gps_reportar', { p_estado: estado }) } catch { /* es un aviso, no frena */ }
  },
  /** Entrega cerrada sin ubicación, con su motivo (queda para la oficina). */
  sinUbicacion: async (shipmentId: string, motivo: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return { ok: true }
    try {
      const { error } = await rpc('entrega_sin_ubicacion', { p_shipment: shipmentId, p_motivo: motivo })
      return error ? { ok: false, error: (error.message ?? '').replace(/^[A-Z_]+:\s*/, '') || 'No se pudo registrar.' } : { ok: true }
    } catch { return { ok: false, error: 'Sin conexión: vuelve a intentarlo.' } }
  },
  /** Oficina · GPS de cada chofer y entregas de hoy cerradas sin ubicación. */
  gpsEstado: async (): Promise<GpsOficina> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return { gps: [], sin_ubicacion: [] }
    try { const { data, error } = await rpc('choferes_gps_estado'); return error || !data ? { gps: [], sin_ubicacion: [] } : data as GpsOficina } catch { return { gps: [], sin_ubicacion: [] } }
  },
  entrega: async (shipmentId: string): Promise<PuntoMapa | null> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return null
    try { const { data } = await rpc('entrega_ubicacion', { p_shipment: shipmentId }); const d = data as PuntoMapa | null; return d ? { ...d, lat: Number(d.lat), lng: Number(d.lng) } : null } catch { return null }
  },
})

/** Enlace a OpenStreetMap con marcador (abre en el navegador o la app de mapas). */
export const enlaceMapa = (lat: number, lng: number): string => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`

// UBICACIÓN EN LA ENTREGA (28 nov 2026, Manuela: «tengo la ubicación activada y me sale que no se pudo leer»). Antes se
// pedía SOLO el GPS fino con 12 s: dentro de una casa o edificio el GPS no engancha a tiempo y se rendía aunque el
// permiso estuviera dado. Ahora: (1) la última posición que ya mandó el rastreo de ruta si es reciente; (2) una lectura
// rápida por red/wifi (aceptando una de hasta 10 min); (3) el GPS fino. Y se distingue «sin permiso» de «no encontró».
let ultimaConocida: { p: GeolocationPosition; t: number } | null = null
/** El rastreo de ruta guarda aquí cada posición que recibe (la entrega la reutiliza si es reciente). */
export function recordarPosicion(p: GeolocationPosition): void { ultimaConocida = { p, t: Date.now() } }

export type MotivoSinUbicacion = 'permiso' | 'no_encontro' | 'no_disponible'
const leer = (opc: PositionOptions): Promise<{ p: GeolocationPosition | null; code: number | null }> => new Promise((res) => {
  try { navigator.geolocation.getCurrentPosition((p) => res({ p, code: null }), (e) => res({ p: null, code: e?.code ?? 2 }), opc) } catch { res({ p: null, code: 2 }) }
})

/** Ubicación para la entrega con el motivo si no se pudo. `ms` = tiempo total aproximado. */
export async function ubicacionConMotivo(ms = 20_000, recienteMs = 3 * 60_000): Promise<{ p: GeolocationPosition; motivo: null } | { p: null; motivo: MotivoSinUbicacion }> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return { p: null, motivo: 'no_disponible' }
  if (ultimaConocida && Date.now() - ultimaConocida.t < recienteMs) return { p: ultimaConocida.p, motivo: null }
  const rapida = await leer({ enableHighAccuracy: false, timeout: Math.min(6_000, ms), maximumAge: 10 * 60_000 })
  if (rapida.p) { recordarPosicion(rapida.p); return { p: rapida.p, motivo: null } }
  if (rapida.code === 1) return { p: null, motivo: 'permiso' }
  const fina = await leer({ enableHighAccuracy: true, timeout: Math.max(4_000, ms - 6_000), maximumAge: 60_000 })
  if (fina.p) { recordarPosicion(fina.p); return { p: fina.p, motivo: null } }
  return { p: null, motivo: fina.code === 1 ? 'permiso' : 'no_encontro' }
}

/** Ubicación de una sola vez (para la entrega). null si no hay permiso / no se encontró. */
export async function ubicacionAhora(ms = 8000): Promise<GeolocationPosition | null> {
  return (await ubicacionConMotivo(ms)).p
}

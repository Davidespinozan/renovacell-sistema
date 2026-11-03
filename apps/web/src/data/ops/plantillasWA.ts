// WA-PLANTILLAS (mig 20270403) · fuera de las 24 h desde el último mensaje del cliente, Meta solo deja mandar plantillas
// aprobadas; cuando contesta, se abre otra ventana de 24 h. La base decide quién puede mandarla, a quién y cada cuándo; la
// salida es la misma cola de WhatsApp de siempre.
import { hasSupabase, supabase } from '../../lib/supabase'

export interface PlantillaWA { nombre: string; etiqueta: string; categoria: 'MARKETING' | 'UTILITY'; cuerpo: string; variables: string[]; botones?: string[]; activa: boolean }
export interface PromoVigente { promocion_id: string; nombre: string; hasta: string }
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export function mensajePlantilla(m: string | undefined): string {
  const x = m ?? ''
  const motivo = /PLANTILLA_[A-Z_]+: ?([^\n]*)/.exec(x)
  if (motivo?.[1]) return motivo[1].charAt(0).toUpperCase() + motivo[1].slice(1) + '.'
  if (/NO_AUTORIZADO/.test(x)) return 'Este cliente no es de tu cartera.'
  if (/ATENDIDA_POR_OTRO: ?(.*)/.test(x)) return `No se puede: ${/ATENDIDA_POR_OTRO: ?(.*)/.exec(x)![1]}.`
  if (/CANAL_EN_ESPEJO/.test(x)) return 'WhatsApp está en modo espejo: todavía no se envían mensajes desde aquí.'
  return 'No se pudo mandar la plantilla. Intenta de nuevo.'
}

export const plantillasWA = (rpc: Rpc = rpcPorDefecto) => ({
  lista: async (): Promise<PlantillaWA[] | null> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return []
    try { const { data, error } = await rpc('cc_wa_plantillas_lista'); return error ? null : Array.isArray(data) ? data as PlantillaWA[] : [] } catch { return null }
  },
  promos: async (): Promise<PromoVigente[]> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return []
    try {
      const { data } = await rpc('promos_vigentes')
      const vistas = new Map<string, PromoVigente>()
      for (const p of (Array.isArray(data) ? data : []) as PromoVigente[]) if (!vistas.has(p.promocion_id)) vistas.set(p.promocion_id, { promocion_id: p.promocion_id, nombre: p.nombre, hasta: p.hasta })
      return [...vistas.values()]
    } catch { return [] }
  },
  enviar: async (conv: string, plantilla: string, promocion?: string | null): Promise<{ ok: true; texto: string } | { ok: false; mensaje: string }> => {
    try {
      const { data, error } = await rpc('cc_wa_plantilla_enviar', { p_conv: conv, p_plantilla: plantilla, p_promocion: promocion ?? null, p_client_id: null })
      if (error) return { ok: false, mensaje: mensajePlantilla(error.message) }
      // Sale ya (si no, el envío de cada minuto la manda).
      if (hasSupabase && rpc === rpcPorDefecto) void supabase.functions.invoke('meta-send', { body: {} }).catch(() => {})
      return { ok: true, texto: String((data as { texto?: string } | null)?.texto ?? '') }
    } catch { return { ok: false, mensaje: 'Sin conexión con el servidor.' } }
  },
  activar: async (nombre: string, activa: boolean): Promise<string | null> => {
    try { const { error } = await rpc('cc_wa_plantilla_activar', { p_nombre: nombre, p_activa: activa }); return error ? 'No se pudo cambiar la plantilla.' : null } catch { return 'Sin conexión con el servidor.' }
  },
})

/** Cómo se verá: {{1}}… con lo que se conoce en pantalla (el servidor pone los valores reales al mandarla). */
export function vistaPrevia(p: PlantillaWA, valores: Partial<Record<string, string>>): string {
  return p.variables.reduce((t, v, i) => t.replace(`{{${i + 1}}}`, valores[v] ?? `[${v}]`), p.cuerpo)
}

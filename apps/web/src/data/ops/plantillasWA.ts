// WA-PLANTILLAS (mig 20270403) · fuera de las 24 h desde el último mensaje del cliente, Meta solo deja mandar plantillas
// aprobadas; cuando contesta, se abre otra ventana de 24 h. La base decide quién puede mandarla, a quién y cada cuándo; la
// salida es la misma cola de WhatsApp de siempre.
import { hasSupabase, supabase } from '../../lib/supabase'

export interface PlantillaWA { nombre: string; etiqueta: string; categoria: 'MARKETING' | 'UTILITY'; cuerpo: string; variables: string[]; botones?: string[]; activa: boolean
  // WA-PLANTILLAS-META (14 nov 2026) · estado en Meta y uso
  estado_meta?: string; motivo_meta?: string | null; enviada_at?: string | null; revisada_at?: string | null; usada?: boolean }
export interface PromoVigente { promocion_id: string; nombre: string; hasta: string }
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>
type Invocar = (fn: string, body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (fn, body) => supabase.functions.invoke(fn, { body }) as unknown as Promise<{ data: unknown; error: unknown }>
/** Mensaje legible de una Edge que respondió con error ({ message }). */
async function mensajeEdge(e: unknown): Promise<string> {
  const ctx = (e as { context?: { json?: () => Promise<unknown> } } | null)?.context
  try { const b = (await ctx?.json?.()) as { message?: string } | undefined; if (b?.message) return b.message } catch { /* sin cuerpo */ }
  return 'Sin conexión con Meta. Intenta de nuevo.'
}
const datosPlantilla = (m: string | undefined) => { const d = /PLANTILLA_DATOS: ?([^\n]*)/.exec(m ?? '')?.[1]; return d ? d.charAt(0).toUpperCase() + d.slice(1) + '.' : null }

export function mensajePlantilla(m: string | undefined): string {
  const x = m ?? ''
  const motivo = /PLANTILLA_[A-Z_]+: ?([^\n]*)/.exec(x)
  if (motivo?.[1]) return motivo[1].charAt(0).toUpperCase() + motivo[1].slice(1) + '.'
  if (/NO_AUTORIZADO/.test(x)) return 'Este cliente no es de tu cartera.'
  if (/ATENDIDA_POR_OTRO: ?(.*)/.test(x)) return `No se puede: ${/ATENDIDA_POR_OTRO: ?(.*)/.exec(x)![1]}.`
  if (/CANAL_EN_ESPEJO/.test(x)) return 'WhatsApp está en modo espejo: todavía no se envían mensajes desde aquí.'
  return 'No se pudo mandar la plantilla. Intenta de nuevo.'
}

/** Datos que solo llena el sistema (difusión, pedidos, invitación): esas plantillas no se ofrecen para escribirle a alguien. */
export const VARS_SISTEMA = ['mensaje', 'folio', 'total', 'envio', 'enlace']
export const paraEscribir = (p: PlantillaWA) => p.activa && !p.variables.some((v) => VARS_SISTEMA.includes(v))

export const plantillasWA = (rpc: Rpc = rpcPorDefecto, invocar: Invocar = invocarPorDefecto) => ({
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
  /** WHATSAPP A TODA LA CARTERA (15 nov 2026) · le escribe a un cliente de su cartera aunque nunca haya escrito por WhatsApp.
   *  Devuelve su conversación; si escribió en las últimas 24 h no manda plantilla (ventana_abierta: se le escribe normal). */
  escribirCliente: async (customerId: string, plantilla: string, promocion?: string | null): Promise<{ ok: true; conversacion: string; ventanaAbierta: boolean; texto: string } | { ok: false; mensaje: string }> => {
    if (!hasSupabase && rpc === rpcPorDefecto) return { ok: false, mensaje: 'Sin conexión con el servidor.' }
    try {
      const { data, error } = await rpc('cc_wa_escribir_cliente', { p_customer: customerId, p_plantilla: plantilla, p_promocion: promocion ?? null })
      if (error) return { ok: false, mensaje: mensajePlantilla(error.message) }
      const d = (data ?? {}) as { conversation_id?: string; ventana_abierta?: boolean; texto?: string }
      if (hasSupabase && rpc === rpcPorDefecto && !d.ventana_abierta) void supabase.functions.invoke('meta-send', { body: {} }).catch(() => {})
      return { ok: true, conversacion: String(d.conversation_id ?? ''), ventanaAbierta: !!d.ventana_abierta, texto: String(d.texto ?? '') }
    } catch { return { ok: false, mensaje: 'Sin conexión con el servidor.' } }
  },
  /** WA-PLANTILLAS-META · Dirección guarda una plantilla (cuerpo con {{1}}… y sus datos). */
  guardar: async (p: { nombre: string; etiqueta: string; categoria: 'MARKETING' | 'UTILITY'; cuerpo: string; variables: string[]; botones: string[] }): Promise<string | null> => {
    try {
      const { error } = await rpc('cc_wa_plantilla_guardar', { p_nombre: p.nombre, p_etiqueta: p.etiqueta, p_categoria: p.categoria, p_cuerpo: p.cuerpo, p_variables: p.variables, p_botones: p.botones })
      if (!error) return null
      return datosPlantilla(error.message) ?? (/NO_AUTORIZADO/.test(error.message ?? '') ? 'Solo Dirección o Almacén crean plantillas.' : 'No se pudo guardar la plantilla.')
    } catch { return 'Sin conexión con el servidor.' }
  },
  borrar: async (nombre: string): Promise<string | null> => {
    try { const { error } = await rpc('cc_wa_plantilla_borrar', { p_nombre: nombre }); return error ? datosPlantilla(error.message) ?? 'No se pudo borrar.' : null } catch { return 'Sin conexión con el servidor.' }
  },
  /** Manda la plantilla a revisión de Meta (Edge wa-plantillas). */
  mandarAMeta: async (nombre: string): Promise<{ ok: true; estado: string } | { ok: false; mensaje: string }> => {
    if (!hasSupabase && invocar === invocarPorDefecto) return { ok: false, mensaje: 'Sin conexión con el servidor.' }
    try { const { data, error } = await invocar('wa-plantillas', { accion: 'enviar', nombre }); if (error) return { ok: false, mensaje: await mensajeEdge(error) }; return { ok: true, estado: String((data as { estado?: string } | null)?.estado ?? 'PENDING') } } catch { return { ok: false, mensaje: 'Sin conexión con el servidor.' } }
  },
  /** Trae de Meta el estado de todas (las aprobadas se encienden solas). */
  sincronizar: async (): Promise<string | null> => {
    if (!hasSupabase && invocar === invocarPorDefecto) return null
    try { const { error } = await invocar('wa-plantillas', { accion: 'sincronizar' }); return error ? await mensajeEdge(error) : null } catch { return 'Sin conexión con Meta.' }
  },
  activar: async (nombre: string, activa: boolean): Promise<string | null> => {
    try { const { error } = await rpc('cc_wa_plantilla_activar', { p_nombre: nombre, p_activa: activa }); return error ? 'No se pudo cambiar la plantilla.' : null } catch { return 'Sin conexión con el servidor.' }
  },
})

/** Cómo se verá: {{1}}… con lo que se conoce en pantalla (el servidor pone los valores reales al mandarla). */
export function vistaPrevia(p: PlantillaWA, valores: Partial<Record<string, string>>): string {
  return p.variables.reduce((t, v, i) => t.replace(`{{${i + 1}}}`, valores[v] ?? `[${v}]`), p.cuerpo)
}

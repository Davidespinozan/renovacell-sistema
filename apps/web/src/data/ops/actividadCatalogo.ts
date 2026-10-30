// IA-VENDEDORA · lo que el doctor hace en el catálogo es señal comercial: búsquedas (con o sin resultados) y fichas vistas.
// Va al servidor (cc_registrar_actividad: solo su propia sesión, sin duplicados en 10 min) y de ahí a la IA y a su vendedor.
// Nunca bloquea ni falla la pantalla. La ficha del producto la decide la base según su verificación (cc_ficha_producto).
import { hasSupabase, supabase } from '../../lib/supabase'

export type TipoActividad = 'busqueda' | 'sin_resultados' | 'ficha'
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, args as never) as unknown as PromiseLike<{ data: unknown; error: unknown }>

export function registrarActividad(tipo: TipoActividad, dato: { product_id?: string; termino?: string }, rpc: Rpc = rpcPorDefecto): void {
  if (!hasSupabase && rpc === rpcPorDefecto) return
  try { void Promise.resolve(rpc('cc_registrar_actividad', { p_tipo: tipo, p_product: dato.product_id ?? null, p_termino: dato.termino ?? null })).catch(() => {}) } catch { /* sin conexión: no pasa nada */ }
}

export interface SeccionFicha { nivel: string; contenido: string; fuente?: { tipo?: string; referencia?: string; documento_url?: string | null } | null }
export interface Ficha {
  product_id: string; nombre: string; categoria: string | null; familia: string | null; presentacion: string | null; imagen_url: string | null; folleto_url: string | null
  conocimiento: Record<string, SeccionFicha>; disclaimers: string[]; audiencia: string
}
export async function leerFicha(productId: string, rpc: Rpc = rpcPorDefecto): Promise<Ficha | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return null
  try { const { data, error } = await rpc('cc_ficha_producto', { p_product: productId, p_audiencia: null }); return error ? null : (data as Ficha | null) } catch { return null }
}

// Orden y nombre de las secciones como las lee un médico: qué es, qué trae, cómo se usa y qué cuidar.
export const SECCIONES_FICHA: Array<[string, string]> = [
  ['resumen', 'Qué es'], ['presentacion', 'Presentación'], ['caracteristicas', 'Características'], ['diferenciadores', 'Diferenciadores'],
  ['composicion', 'Composición'], ['concentracion', 'Concentración'], ['volumen', 'Volumen'], ['tecnologia', 'Tecnología'],
  ['indicaciones', 'Indicaciones'], ['uso_comercial', 'Uso'], ['protocolo', 'Protocolo'], ['contraindicaciones', 'Contraindicaciones'], ['advertencias', 'Advertencias'],
  ['ficha_tecnica', 'Datos técnicos'], ['certificaciones', 'Certificaciones'], ['marca', 'Marca'], ['fabricante', 'Fabricante'], ['faq', 'Preguntas frecuentes'],
]

// ── Lado del vendedor: lo que el cliente buscó y miró (7 días). La base decide si es su cliente. ──
export interface InteresReciente { tipo: TipoActividad; product_id: string | null; producto: string | null; termino: string | null; cuando: string; veces: number }
export async function interesReciente(customerId: string, rpc: Rpc = rpcPorDefecto): Promise<InteresReciente[]> {
  if (!hasSupabase && rpc === rpcPorDefecto) return []
  try { const { data, error } = await rpc('cliente_interes_reciente', { p_customer: customerId }); return error || !Array.isArray(data) ? [] : (data as InteresReciente[]) } catch { return [] }
}
/** "Vio Nabota 100 (3) · buscó «botox» · buscó «exosomas» sin resultados" — corto, para la franja del chat. */
export function resumenInteres(xs: readonly InteresReciente[], max = 3): string {
  return xs.slice(0, max).map((x) => x.tipo === 'ficha' ? `vio ${x.producto}${x.veces > 1 ? ` (${x.veces})` : ''}`
    : x.tipo === 'sin_resultados' ? `buscó «${x.termino}» sin resultados` : `buscó «${x.termino}»`).join(' · ')
}

// PROMO-9 · Flyers: las piezas de marketing (imagen vertical, como las que la empresa manda por WhatsApp e historias) que el
// doctor ve en su Inicio. Dirección / Facturación las suben (Storage `media/flyers`), las ligan a una promoción (viven y
// mueren con ella) o a un producto, y les ponen vigencia y lista. Aquí: tipos, cliente RPC y la subida de la imagen.
import { hasSupabase, supabase } from '../../lib/supabase'
import { uploadImage } from '../../lib/uploads'

export type EstadoFlyer = 'vigente' | 'programado' | 'terminado' | 'pausado'
export interface Flyer { id: string; titulo: string; imagen_url: string; promocion_id: string | null; promocion?: string | null; product_id: string | null; producto?: string | null; desde: string; hasta: string | null; activo: boolean; orden: number; listas: string[] | null; estado: EstadoFlyer; updated_at?: string }
export interface FlyerDatos { id?: string; titulo: string; imagen_url: string; promocion_id?: string | null; product_id?: string | null; desde?: string | null; hasta?: string | null; activo?: boolean; orden?: number; listas?: string[] | null }
type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export const ETIQUETA_FLYER: Record<EstadoFlyer, string> = { vigente: 'Vigente', programado: 'Programado', terminado: 'Terminado', pausado: 'Pausado' }
export const PILL_FLYER: Record<EstadoFlyer, string> = { vigente: 'p-ok', programado: 'p-blue', terminado: 'p-neu', pausado: 'p-warn' }

const traducir = (m: string): string => {
  if (/NO_AUTORIZADO/.test(m)) return 'Solo Dirección o Facturación administran flyers.'
  if (/FLYER_INVALIDO: (.+)/.test(m)) return m.match(/FLYER_INVALIDO: ([^\n]+)/)?.[1] ?? 'Revisa los datos del flyer.'
  if (/FLYER_INEXISTENTE/.test(m)) return 'Ese flyer ya no existe.'
  return m
}

/** Lo que ve el doctor en su Inicio (solo vigentes y de su lista). Sin servidor: nada. */
export async function flyersVigentes(): Promise<Flyer[]> {
  if (!hasSupabase) return []
  const { data, error } = await supabase.rpc('flyers_vigentes')
  if (error) return []
  return (data ?? []) as unknown as Flyer[]
}
export async function listarFlyers(todos = true): Promise<Resultado<Flyer[]>> {
  if (!hasSupabase) return { ok: true, data: [] }
  const { data, error } = await supabase.rpc('flyers_lista', { p_todos: todos })
  if (error) return { ok: false, error: traducir(error.message) }
  return { ok: true, data: (data ?? []) as unknown as Flyer[] }
}
export async function guardarFlyer(d: FlyerDatos): Promise<Resultado<Flyer>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('flyer_guardar', { p: d as never })
  if (error) return { ok: false, error: traducir(error.message) }
  return { ok: true, data: data as unknown as Flyer }
}
export async function estadoFlyer(id: string, activo: boolean): Promise<Resultado<Flyer>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('flyer_estado', { p_id: id, p_activo: activo })
  if (error) return { ok: false, error: traducir(error.message) }
  return { ok: true, data: data as unknown as Flyer }
}
export async function eliminarFlyer(id: string): Promise<Resultado<true>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { error } = await supabase.rpc('flyer_eliminar', { p_id: id })
  if (error) return { ok: false, error: traducir(error.message) }
  return { ok: true, data: true }
}

export const FLYER_MAX_MB = 4
const TIPOS = ['image/jpeg', 'image/png', 'image/webp']
/** Revisa la imagen antes de subirla: tipo y peso. Devuelve el motivo si no sirve. */
export function revisarImagenFlyer(f: Pick<File, 'type' | 'size'>): string | null {
  if (!TIPOS.includes(f.type)) return 'La imagen debe ser JPG, PNG o WebP.'
  if (f.size > FLYER_MAX_MB * 1024 * 1024) return `La imagen pesa más de ${FLYER_MAX_MB} MB; comprímela antes de subirla.`
  return null
}
/** Sube la imagen al bucket público `media` (carpeta flyers) y devuelve su URL. Sin servidor no hay URL https: se rechaza. */
export async function subirImagenFlyer(f: File, subir: typeof uploadImage = uploadImage): Promise<Resultado<string>> {
  const motivo = revisarImagenFlyer(f)
  if (motivo) return { ok: false, error: motivo }
  const url = await subir(f, 'flyers')
  if (!/^https:\/\//.test(url)) return { ok: false, error: 'No se pudo subir la imagen al servidor.' }
  return { ok: true, data: url }
}

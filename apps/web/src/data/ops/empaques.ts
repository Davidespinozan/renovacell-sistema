// EMP-1 · Catálogo de empaques (hieleras y cajas con medidas). Lo lee Empaque para cotizar/generar guías sin teclear
// medidas; lo administran Dirección o Almacén (empaque_guardar). El peso final del paquete siempre se captura al empacar.
import { hasSupabase, supabase } from '../../lib/supabase'

export interface Empaque { id: string; nombre: string; tipo: 'hielera' | 'caja'; largo_cm: number; ancho_cm: number; alto_cm: number; peso_kg: number | null; nota: string | null; frecuente: boolean; activo: boolean; orden: number }
export type EmpaqueDatos = Partial<Omit<Empaque, 'id'>> & { id?: string }
type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export const medidasTexto = (e: Pick<Empaque, 'largo_cm' | 'ancho_cm' | 'alto_cm'>) => `${e.largo_cm}×${e.ancho_cm}×${e.alto_cm} cm`
export const ETIQUETA_TIPO_EMPAQUE: Record<Empaque['tipo'], string> = { hielera: 'Hielera', caja: 'Caja' }

export async function listarEmpaques(todos = false): Promise<Resultado<Empaque[]>> {
  if (!hasSupabase) return { ok: true, data: [] }
  const { data, error } = await supabase.rpc('empaques_lista', { p_todos: todos })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as unknown as Empaque[] }
}
export async function guardarEmpaque(d: EmpaqueDatos): Promise<Resultado<Empaque>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('empaque_guardar', { p: d as never })
  if (error) return { ok: false, error: /NO_AUTORIZADO/.test(error.message) ? 'Solo Dirección o Almacén administran los empaques.' : /duplicate key/.test(error.message) ? 'Ya hay un empaque con ese nombre.' : /check constraint/.test(error.message) ? 'Revisa las medidas (en cm, mayores a 0) y el tipo.' : error.message }
  return { ok: true, data: data as unknown as Empaque }
}

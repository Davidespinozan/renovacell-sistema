// MEDIDOR DE USO (26 nov 2026, auditoría de UX): cuenta qué pantalla y qué pestaña abre el personal, para ordenar el menú
// con datos y no con suposiciones. Solo conteos; nunca bloquea ni muestra errores (si falla, no pasa nada).
import { hasSupabase, supabase } from '../../lib/supabase'

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<unknown>
let rolActivo: string | null = null
let ultimo = ''

/** El rol con el que se está trabajando (null = no medir: doctor o sin sesión). */
export function fijarRolDeUso(rol: string | null): void { rolActivo = rol && rol !== 'doctor' ? rol : null }

/** Clave de lo último registrado: evita contar dos veces el mismo destino por re-renderizados. */
export function esRepetido(pantalla: string, pestana: string, previo: string): { repetido: boolean; clave: string } {
  const clave = `${rolActivo ?? ''}|${pantalla}|${pestana}`
  return { repetido: clave === previo, clave }
}

export function registrarUso(pantalla: string, pestana = ''): void {
  if (!hasSupabase || !rolActivo || import.meta.env.MODE === 'test') return
  const r = esRepetido(pantalla, pestana, ultimo)
  if (r.repetido) return
  ultimo = r.clave
  try { void Promise.resolve((supabase.rpc as unknown as Rpc)('uso_registrar', { p_pantalla: pantalla, p_pestana: pestana, p_rol: rolActivo })).then(() => {}, () => {}) } catch { /* medir nunca rompe la pantalla */ }
}

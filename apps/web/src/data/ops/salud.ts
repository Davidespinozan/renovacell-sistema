// W6-A3.2 · Lectura de la salud del sistema para Dirección.
//
// Fuente ÚNICA: `salud_sistema()` (W6-A3.1). El navegador no lee `sistema_latidos` ni
// `cron.*`; tampoco decide umbrales: el servidor ya clasifica (OK / RUNNING / FAILED /
// STALE) y redacta el mensaje operativo. Aquí solo se valida la forma y se falla cerrado:
// una respuesta que no se entiende es un error de lectura, nunca "todo bien".
import { supabase, hasSupabase } from '../../lib/supabase'

export type EstadoSalud = 'OK' | 'RUNNING' | 'FAILED' | 'STALE'
export interface Salud {
  fuente: string
  estado: EstadoSalud
  mensaje: string | null
  ultimo_ok: string | null
  horas_desde_ok: number | null
  procesados: number | null
}
export type LecturaSalud = { ok: true; data: Salud } | { ok: false; error: string } | { ok: false; sinBackend: true }

export const SALUD_NO_DISPONIBLE = 'No se pudo consultar la salud del sistema.'
export const SALUD_SOLO_DIRECCION = 'La salud del sistema solo la ve Dirección.'
const ESTADOS: readonly EstadoSalud[] = ['OK', 'RUNNING', 'FAILED', 'STALE']

// `salud_sistema` entra a `database.types.ts` al regenerar tras el rollout de A3.1;
// hasta entonces este es el único punto con tipado manual.
type Rpc = { rpc: (f: string, a?: unknown) => PromiseLike<{ data: unknown; error: { message: string } | null }> }

/** Forma estricta: solo lo que la bandeja usa. Cualquier desviación → null (fail-closed). */
export function normalizarSalud(raw: unknown): Salud | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (typeof d.estado !== 'string' || !ESTADOS.includes(d.estado as EstadoSalud)) return null
  if (typeof d.fuente !== 'string' || d.fuente === '') return null
  if (!(d.mensaje === null || typeof d.mensaje === 'string')) return null
  if (!(d.ultimo_ok === null || typeof d.ultimo_ok === 'string')) return null
  const horas = d.horas_desde_ok == null ? null : Number(d.horas_desde_ok)
  const procesados = d.procesados == null ? null : Number(d.procesados)
  if ((horas !== null && !Number.isFinite(horas)) || (procesados !== null && !Number.isFinite(procesados))) return null
  // Un estado con problema sin mensaje del servidor no se pinta con texto inventado.
  if ((d.estado === 'FAILED' || d.estado === 'STALE') && (typeof d.mensaje !== 'string' || d.mensaje.trim() === '')) return null
  return { fuente: d.fuente, estado: d.estado as EstadoSalud, mensaje: d.mensaje as string | null, ultimo_ok: d.ultimo_ok as string | null, horas_desde_ok: horas, procesados }
}

export async function leerSalud(): Promise<LecturaSalud> {
  if (!hasSupabase) return { ok: false, sinBackend: true }
  try {
    const { data, error } = await (supabase as unknown as Rpc).rpc('salud_sistema')
    if (error) return { ok: false, error: /NO_AUTORIZADO/.test(error.message) ? SALUD_SOLO_DIRECCION : SALUD_NO_DISPONIBLE }
    const s = normalizarSalud(data)
    return s ? { ok: true, data: s } : { ok: false, error: SALUD_NO_DISPONIBLE }
  } catch {
    return { ok: false, error: SALUD_NO_DISPONIBLE }
  }
}

/** ¿Hay algo que mostrar? Solo lo que el servidor ya clasificó como problema. */
export const esProblema = (s: Salud): boolean => s.estado === 'FAILED' || s.estado === 'STALE'

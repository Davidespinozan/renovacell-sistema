// CC-1 · Identidad de VISITANTE en el portal (silenciosa).
//
// · Sin sesión: abre/reanuda al visitante (token en localStorage; la atribución se toma de
//   la URL y el referrer). Si la infraestructura falla, el portal sigue igual.
// · Con sesión: pide al servidor que la cuenta adopte lo que ese visitante hizo antes
//   (token poseído) o lo que su registro dejó vinculado (sin token). El perfil lo deriva el
//   servidor del JWT; aquí nunca se manda profile_id ni visitor_id.
//
// El token es opaco y sin PII; aun así se descarta en cuanto el servidor confirma la
// adopción (o dice que pertenece a otra cuenta): un token viejo no debe seguir circulando.
import { hasSupabase, supabase } from '../../lib/supabase'

export const LLAVE_VISITANTE = 'rc_visitor'
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export interface Atribucion {
  utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string
  gclid?: string; fbclid?: string; referrer?: string; landing_path?: string
}

interface Almacen { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void }
function almacen(): Almacen | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

export function leerTokenVisitante(st: Almacen | null = almacen()): string | null {
  try { const t = st?.getItem(LLAVE_VISITANTE) ?? null; return t && TOKEN_RE.test(t) ? t : null } catch { return null }
}
export function guardarTokenVisitante(t: string, st: Almacen | null = almacen()): void {
  try { if (TOKEN_RE.test(t)) st?.setItem(LLAVE_VISITANTE, t) } catch { /* sin almacenamiento: la sesión de visitante no persiste */ }
}
export function olvidarTokenVisitante(st: Almacen | null = almacen()): void {
  try { st?.removeItem(LLAVE_VISITANTE) } catch { /* nada */ }
}

// Atribución desde la URL actual. Solo claves conocidas, sin query en URLs, acotado.
export function leerAtribucion(loc: { search: string; pathname: string } = window.location, referrer: string = document.referrer): { atribucion: Atribucion; ref: string | null } {
  const q = new URLSearchParams(loc.search)
  const g = (k: string, max = 120): string | undefined => { const v = q.get(k); const t = v ? v.trim().slice(0, max) : ''; return t || undefined }
  const atribucion: Atribucion = {
    utm_source: g('utm_source'), utm_medium: g('utm_medium'), utm_campaign: g('utm_campaign'), utm_content: g('utm_content'), utm_term: g('utm_term'),
    gclid: g('gclid', 160), fbclid: g('fbclid', 160),
    referrer: (referrer || '').split('?')[0].slice(0, 300) || undefined,
    landing_path: (loc.pathname || '/').split('?')[0].slice(0, 200),
  }
  for (const k of Object.keys(atribucion) as (keyof Atribucion)[]) if (atribucion[k] === undefined) delete atribucion[k]
  const ref = (g('ref', 8) ?? '').toUpperCase()
  return { atribucion, ref: /^[A-Z2-7]{8}$/.test(ref) ? ref : null }
}

type Invocar = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: unknown; error: unknown }>

/** Abre o reanuda la sesión de visitante. Nunca lanza; si falla, no pasa nada. */
export async function abrirVisitante(deps: { invocar?: Invocar; st?: Almacen | null; loc?: { search: string; pathname: string }; referrer?: string } = {}): Promise<'nuevo' | 'reanudado' | 'omitido' | 'error'> {
  if (!hasSupabase && !deps.invocar) return 'omitido'
  const st = deps.st === undefined ? almacen() : deps.st
  try {
    const { atribucion, ref } = leerAtribucion(deps.loc, deps.referrer)
    const token = leerTokenVisitante(st)
    const { data, error } = await (deps.invocar ?? invocarPorDefecto)('visitor', { body: { action: 'abrir', token, atribucion, ref } })
    if (error || !data || typeof data !== 'object') return 'error'
    const d = data as { nuevo?: boolean; token?: string }
    if (d.nuevo && typeof d.token === 'string') { guardarTokenVisitante(d.token, st); return 'nuevo' }
    return 'reanudado'
  } catch {
    return 'error'
  }
}

/** La cuenta autenticada adopta su visitante (token) o lo que su registro dejó vinculado. */
export async function adoptarVisitante(deps: { invocar?: Invocar; st?: Almacen | null } = {}): Promise<'adoptado' | 'ya_adoptado' | 'nada' | 'ajeno' | 'omitido' | 'error'> {
  if (!hasSupabase && !deps.invocar) return 'omitido'
  const st = deps.st === undefined ? almacen() : deps.st
  try {
    const token = leerTokenVisitante(st)
    const { data, error } = await (deps.invocar ?? invocarPorDefecto)('visitor', { body: { action: 'adoptar', token } })
    if (error) {
      // El token no es de esta cuenta (o ya no vale): se descarta para no insistir.
      let codigo = ''
      try { const ctx = (error as { context?: Response }).context; if (ctx) codigo = ((await ctx.json()) as { error?: string }).error ?? '' } catch { /* sin detalle */ }
      if (codigo === 'visitante_ajeno' || codigo === 'sesion_invalida') { olvidarTokenVisitante(st); return codigo === 'visitante_ajeno' ? 'ajeno' : 'error' }
      return 'error'
    }
    const d = (data ?? {}) as { estado?: string }
    if (d.estado === 'adoptado' || d.estado === 'ya_adoptado') { if (token) olvidarTokenVisitante(st); return d.estado }
    return 'nada'
  } catch {
    return 'error'
  }
}

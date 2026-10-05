// CC-0B · LIMITADOR DE TASA para las Edge Functions públicas (y las caras).
//
// La autoridad es la base: `rate_limit_hit(scope, subject, limit, window, cost)` (ventana
// fija, UPSERT atómico, solo service_role). Este módulo solo decide el SUJETO, aplica la
// configuración y traduce el veredicto a una respuesta. Nada vive en memoria del isolate.
//
// Sujeto:
//   · authenticated → 'uid:<auth.uid()>' (lo dice el JWT, no el cliente).
//   · público → 'ip:<hash>' derivado de la IP; y SIEMPRE además un cubo 'global' por
//     scope, que es la garantía dura: aunque la IP se falsifique, el total por endpoint
//     tiene techo.
//   IP: NO se pudo probar desde el repo/documentación qué cabecera fija el gateway de
//   Supabase. Estrategia conservadora (fail closed): se toma el ÚLTIMO valor de
//   `x-forwarded-for` (el que añade el proxy más cercano, el más difícil de falsificar
//   desde el cliente) o, si no existe, `cf-connecting-ip`; sin ninguna → 'ip:desconocida',
//   un cubo compartido y por tanto más estricto. Nunca se guarda la IP cruda: se guarda
//   un hash (HMAC con RATE_LIMIT_SALT si existe; SHA-256 si no).
//
// Fallos: si la base no responde o devuelve algo inesperado, `limitar` devuelve
// `permitido: false, estado: 'sin_limiter'` → el endpoint responde 503. Para endpoints con
// costo (IA, Auth, lookups pagados) se prefiere cerrar a abrir.
//
// Sin dependencias de Deno ni de observa: la telemetría se INYECTA (`reportar`) por la
// función que ya la tiene (A3.3); las que A3.3 dejó sin instrumentar siguen sin Sentry.

export interface Regla { limite: number; ventanaSegs: number }
export interface Veredicto {
  permitido: boolean
  estado: 'ok' | 'limitado' | 'sin_limiter'
  scope: string
  restante?: number
  reintentarEn?: number   // segundos
  reiniciaEn?: string      // ISO
  desafio?: boolean        // umbral de abuso superado: un CAPTCHA podría pedirse (seam)
}
// `PromiseLike`: el builder de supabase-js es thenable, no una Promise; así el cliente real
// encaja sin casts y un fake de pruebas también.
export interface ClienteRpc {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
}
export type Reportar = (accion: string, clasificacion: 'internal_error' | 'provider_error' | 'unknown' | 'rejected', detalle?: { error?: unknown; mensaje?: string; code?: string | number }) => void

// ---------------------------------------------------------------------------
// CONFIGURACIÓN ÚNICA. Defaults conservadores (desarrollo/pruebas); el dueño puede
// sobreescribir cualquier regla con RATE_LIMITS_JSON = {"scope":{"limite":n,"ventanaSegs":s}}.
// ---------------------------------------------------------------------------
export const LIMITES: Record<string, Regla> = {
  // assistant · landing (público): ráfaga por sujeto, hora por sujeto, techo global por hora.
  assistant_landing_burst:   { limite: 10,  ventanaSegs: 60 },
  assistant_landing_hora:    { limite: 60,  ventanaSegs: 3600 },
  assistant_landing_global:  { limite: 600, ventanaSegs: 3600 },
  // assistant · costo diario (tokens estimados y luego reales) — techo DURO global y por sujeto.
  assistant_tokens_dia:      { limite: 200_000, ventanaSegs: 86400 },
  assistant_tokens_dia_uid:  { limite: 50_000,  ventanaSegs: 86400 },
  // assistant · doctor (autenticado): por uid.
  assistant_doctor_burst:    { limite: 30,  ventanaSegs: 60 },
  // capture-lead (público).
  capture_lead:              { limite: 5,   ventanaSegs: 600 },
  capture_lead_global:       { limite: 100, ventanaSegs: 3600 },
  // register-doctor (público; crea cuentas, sube evidencia, consulta proveedores).
  register_doctor:           { limite: 3,   ventanaSegs: 3600 },
  register_doctor_global:    { limite: 30,  ventanaSegs: 3600 },
}
// Por encima de este múltiplo del límite se marca `desafio` (seam para CAPTCHA).
export const FACTOR_DESAFIO = 2

function envPorDefecto(k: string): string | undefined {
  try { return (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno?.env?.get?.(k) ?? undefined } catch { return undefined }
}

export function regla(scope: string, env: (k: string) => string | undefined = envPorDefecto): Regla {
  const base = LIMITES[scope]
  if (!base) throw new Error(`scope de límite desconocido: ${scope}`)
  try {
    const raw = env('RATE_LIMITS_JSON')
    if (!raw) return base
    const o = JSON.parse(raw)?.[scope]
    const limite = Number(o?.limite), ventanaSegs = Number(o?.ventanaSegs)
    if (Number.isInteger(limite) && limite >= 1 && Number.isInteger(ventanaSegs) && ventanaSegs >= 1 && ventanaSegs <= 604800) {
      return { limite, ventanaSegs }
    }
    return base   // configuración inválida: se ignora, nunca abre ni cierra de más
  } catch {
    return base
  }
}

// ---------------------------------------------------------------------------
// SUJETO
// ---------------------------------------------------------------------------
export function ipDe(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const partes = xff.split(',').map((s) => s.trim()).filter(Boolean)
    const ultimo = partes[partes.length - 1]
    if (ultimo && /^[0-9a-fA-F.:]{3,45}$/.test(ultimo)) return ultimo
  }
  const cf = req.headers.get('cf-connecting-ip')
  if (cf && /^[0-9a-fA-F.:]{3,45}$/.test(cf.trim())) return cf.trim()
  return null
}

async function hash(texto: string, llave: string | undefined): Promise<string> {
  const enc = new TextEncoder()
  if (llave) {
    const k = await crypto.subtle.importKey('raw', enc.encode(llave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', k, enc.encode(texto))
    return hex(sig).slice(0, 32)
  }
  const d = await crypto.subtle.digest('SHA-256', enc.encode(texto))
  return hex(d).slice(0, 32)
}
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('')

/** Sujeto público: 'ip:<hash>' o 'ip:desconocida' (cubo compartido, más estricto). */
export async function sujetoPublico(req: Request, env: (k: string) => string | undefined = envPorDefecto): Promise<string> {
  const ip = ipDe(req)
  if (!ip) return 'ip:desconocida'
  return 'ip:' + await hash(ip, env('RATE_LIMIT_SALT'))
}
export const sujetoUid = (uid: string): string => `uid:${uid}`

// ---------------------------------------------------------------------------
// VEREDICTO
// ---------------------------------------------------------------------------
/** Nunca lanza. Un fallo del limitador = no permitido ('sin_limiter'). */
export async function limitar(
  cliente: ClienteRpc, scope: string, sujeto: string,
  opts: { costo?: number; env?: (k: string) => string | undefined; reportar?: Reportar } = {},
): Promise<Veredicto> {
  const env = opts.env ?? envPorDefecto
  let r: Regla
  try { r = regla(scope, env) } catch (e) {
    opts.reportar?.('limitar', 'internal_error', { code: 'scope_desconocido', error: e })
    return { permitido: false, estado: 'sin_limiter', scope }
  }
  try {
    const { data, error } = await cliente.rpc('rate_limit_hit', {
      p_scope: scope, p_subject: sujeto, p_limit: r.limite, p_window_secs: r.ventanaSegs, p_cost: opts.costo ?? 1,
    })
    if (error) {
      opts.reportar?.('limitar', 'internal_error', { code: 'rpc_error', error })
      return { permitido: false, estado: 'sin_limiter', scope }
    }
    const v = data as { allowed?: unknown; count?: unknown; remaining?: unknown; retry_after_secs?: unknown; reset_at?: unknown } | null
    if (!v || typeof v.allowed !== 'boolean') {
      opts.reportar?.('limitar', 'internal_error', { code: 'respuesta_invalida' })
      return { permitido: false, estado: 'sin_limiter', scope }
    }
    const count = Number(v.count ?? 0)
    return {
      permitido: v.allowed,
      estado: v.allowed ? 'ok' : 'limitado',
      scope,
      restante: Number(v.remaining ?? 0),
      reintentarEn: Math.max(1, Number(v.retry_after_secs ?? 1)),
      reiniciaEn: typeof v.reset_at === 'string' ? v.reset_at : undefined,
      desafio: count > r.limite * FACTOR_DESAFIO,
    }
  } catch (e) {
    opts.reportar?.('limitar', 'internal_error', { code: 'exception', error: e })
    return { permitido: false, estado: 'sin_limiter', scope }
  }
}

/** Aplica varias reglas en orden; la primera que no permite, manda. */
export async function limitarTodas(
  cliente: ClienteRpc, reglas: Array<{ scope: string; sujeto: string; costo?: number }>,
  opts: { env?: (k: string) => string | undefined; reportar?: Reportar } = {},
): Promise<Veredicto> {
  let ultimo: Veredicto = { permitido: true, estado: 'ok', scope: '' }
  for (const r of reglas) {
    ultimo = await limitar(cliente, r.scope, r.sujeto, { costo: r.costo, ...opts })
    if (!ultimo.permitido) return ultimo
  }
  return ultimo
}

/** Respuesta controlada: 429 (limitado) o 503 (limitador caído). Sin detalles internos. */
export function respuestaLimite(v: Veredicto, extraHeaders: Record<string, string> = {}): Response {
  if (v.estado === 'sin_limiter') {
    return new Response(JSON.stringify({ error: 'no_disponible', message: 'El servicio no está disponible en este momento. Intenta más tarde.' }),
      { status: 503, headers: { ...extraHeaders, 'Content-Type': 'application/json', 'Retry-After': '30' } })
  }
  const segs = Math.max(1, v.reintentarEn ?? 60)
  return new Response(JSON.stringify({
    error: 'rate_limited', message: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.',
    retry_after_secs: segs, ...(v.desafio ? { challenge: 'captcha' } : {}),
  }), { status: 429, headers: { ...extraHeaders, 'Content-Type': 'application/json', 'Retry-After': String(segs) } })
}

// ---------------------------------------------------------------------------
// SEAM DE DESAFÍO (Turnstile). Dormido sin TURNSTILE_SECRET: nunca bloquea ni abre.
// Con secreto: un token válido en `cf-turnstile-response` cuenta como "verificado" y el
// endpoint puede decidir perdonar SOLO la ráfaga (nunca el techo diario/global).
// ---------------------------------------------------------------------------
export async function desafioResuelto(
  req: Request, env: (k: string) => string | undefined = envPorDefecto,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (i, o) => fetch(i, o),
): Promise<'no_configurado' | 'ok' | 'fallido'> {
  const secreto = env('TURNSTILE_SECRET')
  if (!secreto) return 'no_configurado'
  const token = req.headers.get('cf-turnstile-response')
  if (!token || token.length > 2048) return 'fallido'
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000)
    const r = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secreto, response: token }), signal: ctl.signal,
    })
    clearTimeout(t)
    const d = await r.json().catch(() => ({})) as { success?: unknown }
    return r.ok && d?.success === true ? 'ok' : 'fallido'
  } catch { return 'fallido' }
}

/** Estimación barata de tokens para pre-cargar el costo diario antes de llamar al modelo. */
export function tokensEstimados(textos: string[], maxSalida: number): number {
  const chars = textos.reduce((s, t) => s + (t?.length ?? 0), 0)
  return Math.ceil(chars / 4) + maxSalida
}

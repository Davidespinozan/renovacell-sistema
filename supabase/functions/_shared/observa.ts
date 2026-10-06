// W6-A3.3 · TELEMETRÍA DE ERRORES para Edge Functions (opcional, fail-open).
//
// Qué es: una forma de que una Edge Function diga "aquí pasó algo que Dirección y
// quien dé mantenimiento deberían ver" (proveedor caído, resultado incierto, falla
// al persistir) y que ese aviso llegue a Sentry SI está configurado.
//
// Qué NO es: autoridad operativa. Sentry no decide nada: no cambia una respuesta,
// no convierte un UNKNOWN en FAILED ni al revés, no reintenta, no bloquea. La
// verdad sigue en la base (shipping_attempts, invoice_meta, comm_outbox, libro).
//
// Garantías:
//   · Sin SENTRY_DSN → no-op total: 0 llamadas de red, 0 lecturas extra.
//   · Con DSN inválido, Sentry caído, lento o respondiendo 500 → la función responde
//     exactamente igual. El envío tiene timeout (TIMEOUT_OBSERVA_MS).
//   · Ninguna excepción del helper escapa: `capturar` nunca lanza ni rechaza.
//   · El cuerpo que viaja es una LISTA BLANCA (ver `construirEvento`). Nada del
//     request, nada del proveedor, nada de personas. El único texto libre es el
//     mensaje y pasa por `sanitizarTexto`.
//   · Fire-and-forget real: si el runtime expone `EdgeRuntime.waitUntil` (Supabase
//     Edge Runtime), el envío se registra ahí y la respuesta sale sin esperar. Si no
//     existe, el envío acotado corre en segundo plano y puede perderse al apagarse
//     el isolate: se prefiere perder un evento a retrasar una respuesta.
//
// Sin dependencias de Deno en el módulo: `fetch`, `env` y `waitUntil` se inyectan
// (con valores por defecto perezosos) para poder probarlo con fakes.
// Sin imports: como el resto de `_shared`, el módulo es autocontenido para poder
// probarse desde vitest sin extensiones `.ts` en las rutas.

// ── SANITIZADOR (inicio) ─────────────────────────────────────────────────────
// Última línea de defensa antes de que un texto salga hacia el proveedor de
// observabilidad. Reglas, en este orden:
//   1. Credenciales (Bearer/Basic, JWT, llaves sk_live_/whsec_/pk_, pares secret=valor,
//      hex/base64 largos) → el mensaje COMPLETO se reemplaza por uno genérico.
//   2. Datos de persona (correo, teléfono, RFC, CURP) → marcador.
//   3. URLs → se conservan host y ruta; query y fragmento se eliminan.
//   4. Recorte a `max` caracteres.
// El frontend lleva una COPIA literal de esta sección en apps/web/src/lib/sanitizar.ts
// (el bundle no importa fuera de apps/web); observa.test.ts exige que sean idénticas.
export const MENSAJE_GENERICO = 'mensaje omitido: contenía datos sensibles'
export const MAX_MENSAJE = 200

export interface Sanitizado {
  texto: string
  // true cuando el mensaje original fue descartado por completo (credenciales).
  generico: boolean
}

// Credenciales: cualquiera de estas presencias descarta el mensaje entero.
const CREDENCIALES: RegExp[] = [
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i,
  // JWT: tres segmentos base64url, el primero suele empezar por eyJ.
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/,
  // Llaves de proveedores (Stripe, webhooks, Facturama-like, genéricas).
  /\b(?:sk|pk|rk|whsec|sbp|xox[abp])_(?:live|test)?_?[A-Za-z0-9]{8,}/i,
  // Pares secret=valor / "password": "valor" / apikey: valor.
  /\b(?:password|passwd|pass|secret|token|apikey|api[_-]?key|authorization|service[_-]?role[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\b["']?\s*[:=]\s*["']?[^\s"',;&]{4,}/i,
  // Secreto en query string.
  /[?&](?:token|key|apikey|api_key|secret|password|access_token|code)=[^&\s]+/i,
  // Hex largo (≥ 32) o base64 largo (≥ 40) sin espacios: parecen llaves/hashes de sesión.
  /\b[0-9a-f]{32,}\b/i,
  /(?:^|[^A-Za-z0-9+/=])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/,
]

const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// Teléfono: 10 dígitos (MX) o +código, con separadores opcionales.
const TELEFONO = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)\d{3,4}[\s.-]?\d{4}\b/g
// RFC (persona física 13 / moral 12) y CURP (18).
const RFC = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g
const CURP = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/g
// URL: se guarda esquema+host+ruta, se tira ?query y #fragmento.
const URL_RE = /\b(https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?)(?:[?#][^\s]*)?/gi

export function contieneCredencial(texto: string): boolean {
  return CREDENCIALES.some((re) => re.test(texto))
}

export function sanitizarTexto(entrada: unknown, max = MAX_MENSAJE): Sanitizado {
  let t: string
  try {
    t = typeof entrada === 'string' ? entrada : entrada instanceof Error ? String(entrada.message ?? '') : entrada == null ? '' : JSON.stringify(entrada)
  } catch {
    t = ''
  }
  if (typeof t !== 'string') t = ''
  if (contieneCredencial(t)) return { texto: MENSAJE_GENERICO, generico: true }
  const limpio = t
    .replace(URL_RE, '$1')
    .replace(CORREO, '[correo]')
    .replace(CURP, '[curp]')
    .replace(RFC, '[rfc]')
    .replace(TELEFONO, '[tel]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
  // Segunda pasada: si al limpiar quedó algo que parece credencial (p. ej. la URL
  // tenía el token en la ruta), se descarta igual.
  if (contieneCredencial(limpio)) return { texto: MENSAJE_GENERICO, generico: true }
  return { texto: limpio, generico: false }
}

// Nombre de la clase de error / código: solo identificadores cortos. Nunca texto libre.
export function sanitizarCodigo(v: unknown, max = 64): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  if (!s) return undefined
  if (!/^[A-Za-z0-9_.:-]+$/.test(s)) return undefined
  return s.slice(0, max)
}

// Quita query y fragmento de una URL (para `request.url` y migas del navegador).
export function urlSinSecretos(u: unknown): string | undefined {
  if (typeof u !== 'string' || !u) return undefined
  const sin = u.split(/[?#]/)[0]
  return contieneCredencial(sin) ? undefined : sin
}
// ── SANITIZADOR (fin) ────────────────────────────────────────────────────────


export type Clasificacion = 'rejected' | 'unknown' | 'provider_error' | 'internal_error'
export const CLASIFICACIONES: readonly Clasificacion[] = ['rejected', 'unknown', 'provider_error', 'internal_error']

export interface EventoObserva {
  funcion: string               // nombre lógico de la Edge Function (p. ej. 'shipping')
  accion: string                // acción/operación (p. ej. 'create_shipment')
  clasificacion: Clasificacion
  // Uno de los dos: el error (se toma clase + mensaje) o un mensaje ya elegido.
  error?: unknown
  mensaje?: string
  code?: string | number        // código corto (HTTP del proveedor, código de negocio)
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>
export interface Deps {
  fetch?: Fetch
  env?: (k: string) => string | undefined
  waitUntil?: ((p: Promise<unknown>) => void) | null
  timeoutMs?: number
  ahora?: () => Date
  idEvento?: () => string
}

export type ResultadoCaptura = 'omitido' | 'encolado' | 'enviado' | 'fallido'

export const TIMEOUT_OBSERVA_MS = 1500
export const CLIENTE_OBSERVA = 'renovacell-edge/1'

// Claves EXACTAS que puede llevar un evento. Cualquier otra cosa no existe.
export const CLAVES_EVENTO = ['event_id', 'timestamp', 'platform', 'level', 'logger', 'environment', 'release', 'tags', 'exception', 'message'] as const
export const CLAVES_TAGS = ['funcion', 'accion', 'clasificacion', 'code'] as const

export interface Dsn { endpoint: string; llave: string }

// DSN de Sentry: https://<llave>@<host>/<proyecto>. Cualquier otra forma → null (no-op).
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn || typeof dsn !== 'string') return null
  let u: URL
  try { u = new URL(dsn.trim()) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const llave = u.username
  const proyecto = u.pathname.replace(/\/+$/, '').split('/').pop() ?? ''
  if (!llave || !/^[A-Za-z0-9]+$/.test(llave)) return null
  if (!proyecto || !/^\d+$/.test(proyecto)) return null
  const base = u.pathname.slice(0, u.pathname.lastIndexOf('/' + proyecto))
  return { endpoint: `${u.protocol}//${u.host}${base}/api/${proyecto}/envelope/`, llave }
}

function claseDe(error: unknown): string {
  if (error instanceof Error) return sanitizarCodigo(error.name) ?? 'Error'
  if (error && typeof error === 'object') {
    const o = error as { name?: unknown; code?: unknown }
    return sanitizarCodigo(o.name) ?? sanitizarCodigo(o.code) ?? 'Error'
  }
  return 'Error'
}

function mensajeDe(e: EventoObserva): string {
  const crudo = e.mensaje ?? (e.error instanceof Error ? e.error.message : e.error != null ? String((e.error as { message?: unknown })?.message ?? e.error) : '')
  const s = sanitizarTexto(crudo, MAX_MENSAJE)
  return s.texto || `${e.clasificacion} en ${e.funcion}`
}

export interface EventoSentry {
  event_id: string
  timestamp: string
  platform: 'javascript'
  level: 'error' | 'warning'
  logger: 'edge'
  environment: string
  release?: string
  tags: { funcion: string; accion: string; clasificacion: Clasificacion; code?: string }
  exception: { values: [{ type: string; value: string }] }
  message: string
}

// Construye el evento por LISTA BLANCA. Solo esto viaja; nada se copia del request.
export function construirEvento(e: EventoObserva, env: (k: string) => string | undefined, ahora: Date, id: string): EventoSentry {
  const funcion = sanitizarCodigo(e.funcion) ?? 'edge'
  const accion = sanitizarCodigo(e.accion) ?? 'desconocida'
  const clasificacion: Clasificacion = CLASIFICACIONES.includes(e.clasificacion) ? e.clasificacion : 'internal_error'
  const code = sanitizarCodigo(e.code)
  const tipo = e.error != null ? claseDe(e.error) : clasificacion
  const mensaje = mensajeDe(e)
  const release = sanitizarCodigo(env('SENTRY_RELEASE'))
  const ev: EventoSentry = {
    event_id: id.replace(/-/g, '').slice(0, 32).padEnd(32, '0'),
    timestamp: ahora.toISOString(),
    platform: 'javascript',
    level: clasificacion === 'rejected' ? 'warning' : 'error',
    logger: 'edge',
    environment: sanitizarCodigo(env('SENTRY_ENVIRONMENT')) ?? 'edge',
    tags: { funcion, accion, clasificacion, ...(code ? { code } : {}) },
    exception: { values: [{ type: tipo, value: mensaje }] },
    message: `${funcion}/${accion}: ${mensaje}`,
  }
  if (release) ev.release = release
  return ev
}

export function construirSobre(ev: EventoSentry, dsn: Dsn): { url: string; headers: Record<string, string>; body: string } {
  const cabecera = JSON.stringify({ event_id: ev.event_id, sent_at: ev.timestamp })
  const item = JSON.stringify({ type: 'event', content_type: 'application/json' })
  return {
    url: dsn.endpoint,
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=${CLIENTE_OBSERVA}, sentry_key=${dsn.llave}`,
    },
    body: `${cabecera}\n${item}\n${JSON.stringify(ev)}\n`,
  }
}

function envPorDefecto(k: string): string | undefined {
  try {
    const d = (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno
    return d?.env?.get?.(k) ?? undefined
  } catch { return undefined }
}

function waitUntilPorDefecto(): ((p: Promise<unknown>) => void) | null {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  return typeof rt?.waitUntil === 'function' ? (p) => rt.waitUntil!(p) : null
}

function idPorDefecto(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}` }
}

async function enviar(sobre: { url: string; headers: Record<string, string>; body: string }, f: Fetch, timeoutMs: number): Promise<ResultadoCaptura> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await f(sobre.url, { method: 'POST', headers: sobre.headers, body: sobre.body, signal: ctl.signal })
    return r.ok ? 'enviado' : 'fallido'
  } catch {
    return 'fallido'
  } finally {
    clearTimeout(t)
  }
}

/**
 * Reporta un error operativo. NUNCA lanza ni rechaza. Sin DSN devuelve 'omitido' sin
 * tocar la red. Con `waitUntil` devuelve 'encolado' de inmediato; sin él, resuelve
 * cuando el envío acotado termina (o 'fallido' si no pudo).
 *
 * Uso en una Edge Function: `void capturar({...})` — nunca se espera.
 */
export function capturar(e: EventoObserva, deps: Deps = {}): Promise<ResultadoCaptura> {
  try {
    const env = deps.env ?? envPorDefecto
    const dsn = parseDsn(env('SENTRY_DSN'))
    if (!dsn) return Promise.resolve('omitido')
    const f = deps.fetch ?? ((globalThis as { fetch?: Fetch }).fetch as Fetch | undefined)
    if (!f) return Promise.resolve('fallido')
    const ahora = (deps.ahora ?? (() => new Date()))()
    const id = (deps.idEvento ?? idPorDefecto)()
    const ev = construirEvento(e, env, ahora, id)
    const sobre = construirSobre(ev, dsn)
    const timeoutMs = Math.max(100, Math.min(deps.timeoutMs ?? TIMEOUT_OBSERVA_MS, 5000))
    const envio = enviar(sobre, f, timeoutMs).catch((): ResultadoCaptura => 'fallido')
    const wu = deps.waitUntil === undefined ? waitUntilPorDefecto() : deps.waitUntil
    if (wu) {
      try { wu(envio) } catch { /* el runtime no lo aceptó: el envío sigue en segundo plano */ }
      return Promise.resolve('encolado')
    }
    return envio
  } catch {
    return Promise.resolve('fallido')
  }
}

/** Atajo por función: fija el nombre lógico una vez. Igual de fail-open que `capturar`. */
export function observador(funcion: string, deps: Deps = {}) {
  return (accion: string, clasificacion: Clasificacion, detalle: { error?: unknown; mensaje?: string; code?: string | number } = {}): void => {
    try { void capturar({ funcion, accion, clasificacion, ...detalle }, deps) } catch { /* nunca */ }
  }
}

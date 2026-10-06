// Observabilidad (seam listo-para-credencial, estilo integraciones de Renovacell).
// Sentry se ACTIVA solo si existe VITE_SENTRY_DSN; sin DSN es no-op total. Además se
// importa DINÁMICAMENTE, así que en el build sin DSN (demo) queda en su propio chunk que
// nunca se descarga — cero peso para el usuario. Para encenderlo: poner el DSN en el env.
//
// W6-A3.3 · Lo que sale hacia Sentry pasa por `limpiarEvento` (beforeSend): sin cabeceras,
// cookies, cuerpo del request, usuario, migas ni query/hash de URLs (el enlace de
// recuperación de contraseña viaja en el hash). Los mensajes pasan por el sanitizador.
// Sentry NO es autoridad operativa: si falla, la app sigue igual.
import { sanitizarTexto, urlSinSecretos } from './sanitizar'

type SentryMod = typeof import('@sentry/react')
let sentry: SentryMod | null = null
let initTried = false

const dsn = (): string | undefined => {
  const v = import.meta.env.VITE_SENTRY_DSN as string | undefined
  return v && v.trim() ? v.trim() : undefined
}

export function sentryEnabled(): boolean { return !!dsn() }

// Forma mínima de un evento de Sentry que nos interesa limpiar. No dependemos de los
// tipos del SDK para que el sanitizador se pueda probar sin cargarlo.
export interface EventoFrontend {
  message?: unknown
  request?: { url?: unknown; headers?: unknown; cookies?: unknown; data?: unknown; query_string?: unknown; env?: unknown } | undefined
  user?: unknown
  breadcrumbs?: unknown
  contexts?: unknown
  extra?: unknown
  tags?: Record<string, unknown>
  exception?: { values?: Array<{ type?: unknown; value?: unknown; stacktrace?: unknown; mechanism?: unknown }> }
  [k: string]: unknown
}

const TAGS_PERMITIDOS = ['pantalla', 'clasificacion', 'code'] as const

/**
 * beforeSend: lista blanca. Devuelve un evento NUEVO con solo lo permitido; nunca lanza
 * (si algo falla, se descarta el evento: `null`, antes que mandar algo sin limpiar).
 */
export function limpiarEvento<T extends EventoFrontend>(ev: T): T | null {
  try {
    const limpio: EventoFrontend = {}
    // Identidad y metadatos del evento que el SDK necesita para agrupar.
    for (const k of ['event_id', 'timestamp', 'platform', 'level', 'environment', 'release', 'sdk', 'type', 'logger', 'transaction'] as const) {
      if (ev[k] !== undefined) limpio[k] = ev[k]
    }
    if (ev.message !== undefined) limpio.message = sanitizarTexto(ev.message).texto
    if (ev.exception?.values) {
      limpio.exception = {
        values: ev.exception.values.map((v) => ({
          type: typeof v.type === 'string' ? v.type.slice(0, 64) : 'Error',
          value: sanitizarTexto(v.value).texto,
          // Los frames llevan rutas y nombres de función, no datos. Se conservan sin
          // variables locales (`vars`) por si el SDK alguna vez las adjuntara.
          ...(v.stacktrace ? { stacktrace: sinVars(v.stacktrace) } : {}),
          ...(v.mechanism ? { mechanism: v.mechanism } : {}),
        })),
      }
    }
    const url = urlSinSecretos(ev.request?.url)
    if (url) limpio.request = { url }
    if (ev.tags) {
      const tags: Record<string, unknown> = {}
      for (const k of TAGS_PERMITIDOS) if (typeof ev.tags[k] === 'string') tags[k] = String(ev.tags[k]).slice(0, 64)
      if (Object.keys(tags).length) limpio.tags = tags
    }
    // Explícitamente FUERA: user, breadcrumbs, contexts, extra, request.headers/cookies/data.
    return limpio as T
  } catch {
    return null
  }
}

function sinVars(st: unknown): unknown {
  if (!st || typeof st !== 'object') return st
  const frames = (st as { frames?: unknown }).frames
  if (!Array.isArray(frames)) return st
  return {
    frames: frames.map((f) => {
      if (!f || typeof f !== 'object') return f
      const { vars: _vars, ...resto } = f as Record<string, unknown>
      if (typeof resto.abs_path === 'string') resto.abs_path = urlSinSecretos(resto.abs_path)
      if (typeof resto.filename === 'string') resto.filename = urlSinSecretos(resto.filename)
      return resto
    }),
  }
}

// Opciones que se entregan al SDK. Exportadas para probarlas sin cargar @sentry/react.
export function opcionesSentry(): Record<string, unknown> {
  return {
    dsn: dsn(),
    environment: (import.meta.env.VITE_SENTRY_ENV as string | undefined) ?? import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE as string | undefined,
    // Trazas ligeras: es un ERP interno, no necesitamos muestrear todo.
    tracesSampleRate: 0.1,
    sendDefaultPii: false, // datos de pacientes/doctores: no mandar PII por defecto.
    // Sin migas automáticas (fetch/xhr/navegación llevan URLs con hash/query).
    maxBreadcrumbs: 0,
    beforeSend: limpiarEvento,
    beforeSendTransaction: () => null, // no se mandan transacciones con URLs.
    beforeBreadcrumb: () => null,
  }
}

// Arranca Sentry si hay DSN. Fire-and-forget desde main.tsx: no bloquea el render.
export async function initSentry(): Promise<void> {
  if (initTried || !dsn()) return
  initTried = true
  try {
    const mod = await import('@sentry/react')
    mod.init(opcionesSentry() as Parameters<SentryMod['init']>[0])
    sentry = mod
  } catch (e) {
    // Nunca romper la app por telemetría.
    if (import.meta.env.DEV) console.warn('[sentry] no se pudo iniciar', e)
  }
}

// Reporta un error manejado. No-op si Sentry no está activo (en dev, lo loguea).
// `context` se convierte en TAGS permitidas (solo claves cortas conocidas); nunca en `extra`.
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  try {
    if (sentry) {
      const tags: Record<string, string> = {}
      if (context) for (const k of TAGS_PERMITIDOS) if (typeof context[k] === 'string') tags[k] = String(context[k]).slice(0, 64)
      sentry.captureException(error, Object.keys(tags).length ? { tags } : undefined)
    } else if (import.meta.env.DEV) {
      console.error('[obs] error capturado (Sentry off)', error, context ?? '')
    }
  } catch { /* nunca romper la app por telemetría */ }
}

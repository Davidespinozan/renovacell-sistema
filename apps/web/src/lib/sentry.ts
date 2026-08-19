// Observabilidad (seam listo-para-credencial, estilo integraciones de Renovacell).
// Sentry se ACTIVA solo si existe VITE_SENTRY_DSN; sin DSN es no-op total. Además se
// importa DINÁMICAMENTE, así que en el build sin DSN (demo) queda en su propio chunk que
// nunca se descarga — cero peso para el usuario. Para encenderlo: poner el DSN en el env.
type SentryMod = typeof import('@sentry/react')
let sentry: SentryMod | null = null
let initTried = false

const dsn = (): string | undefined => {
  const v = import.meta.env.VITE_SENTRY_DSN as string | undefined
  return v && v.trim() ? v.trim() : undefined
}

export function sentryEnabled(): boolean { return !!dsn() }

// Arranca Sentry si hay DSN. Fire-and-forget desde main.tsx: no bloquea el render.
export async function initSentry(): Promise<void> {
  if (initTried || !dsn()) return
  initTried = true
  try {
    const mod = await import('@sentry/react')
    mod.init({
      dsn: dsn(),
      environment: (import.meta.env.VITE_SENTRY_ENV as string | undefined) ?? import.meta.env.MODE,
      release: import.meta.env.VITE_RELEASE as string | undefined,
      // Trazas ligeras: es un ERP interno, no necesitamos muestrear todo.
      tracesSampleRate: 0.1,
      sendDefaultPii: false, // datos de pacientes/doctores: no mandar PII por defecto.
    })
    sentry = mod
  } catch (e) {
    // Nunca romper la app por telemetría.
    if (import.meta.env.DEV) console.warn('[sentry] no se pudo iniciar', e)
  }
}

// Reporta un error manejado. No-op si Sentry no está activo (en dev, lo loguea).
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (sentry) sentry.captureException(error, context ? { extra: context } : undefined)
  else if (import.meta.env.DEV) console.error('[obs] error capturado (Sentry off)', error, context ?? '')
}

// W6-A3.3 · Sentry en el frontend: sin DSN no existe; con DSN, lo que sale es una lista
// blanca (sin headers, cookies, cuerpo, usuario, migas ni query/hash de URL) y los
// mensajes pasan por el sanitizador. Nunca rompe la app.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sdk = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }))
vi.mock('@sentry/react', () => sdk)

async function cargar() {
  vi.resetModules()
  return await import('./sentry')
}

beforeEach(() => { sdk.init.mockClear(); sdk.captureException.mockClear() })
afterEach(() => { vi.unstubAllEnvs() })

describe('sin DSN (estado actual de producción)', () => {
  it('O · initSentry no carga ni inicia el SDK; captureError es no-op y no lanza', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const m = await cargar()
    expect(m.sentryEnabled()).toBe(false)
    await m.initSentry()
    expect(sdk.init).not.toHaveBeenCalled()
    expect(() => m.captureError(new Error('x'), { pantalla: 'bandeja' })).not.toThrow()
    expect(sdk.captureException).not.toHaveBeenCalled()
  })
})

describe('con DSN', () => {
  it('inicia una sola vez con PII apagada, sin migas y con beforeSend = limpiarEvento', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.sentry.io/1')
    const m = await cargar()
    expect(m.sentryEnabled()).toBe(true)
    await m.initSentry()
    await m.initSentry()
    expect(sdk.init).toHaveBeenCalledTimes(1)
    const opts = sdk.init.mock.calls[0][0] as Record<string, unknown>
    expect(opts).toMatchObject({ dsn: 'https://k@o1.ingest.sentry.io/1', sendDefaultPii: false, tracesSampleRate: 0.1, maxBreadcrumbs: 0 })
    expect(opts.beforeSend).toBe(m.limpiarEvento)
    expect((opts.beforeBreadcrumb as () => unknown)()).toBeNull()
    expect((opts.beforeSendTransaction as () => unknown)()).toBeNull()
  })
  it('captureError pasa solo tags permitidas; nunca `extra`', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.sentry.io/1')
    const m = await cargar()
    await m.initSentry()
    m.captureError(new Error('x'), { pantalla: 'bandeja', componentStack: 'at Bandeja', email: 'a@b.mx' })
    expect(sdk.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { pantalla: 'bandeja' } })
    m.captureError(new Error('y'), { componentStack: 'at X' })
    expect(sdk.captureException).toHaveBeenLastCalledWith(expect.any(Error), undefined)
  })
  it('si el SDK revienta al iniciar, la app sigue', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.sentry.io/1')
    sdk.init.mockImplementationOnce(() => { throw new Error('sdk roto') })
    const m = await cargar()
    await expect(m.initSentry()).resolves.toBeUndefined()
    expect(() => m.captureError(new Error('x'))).not.toThrow()
  })
})

describe('limpiarEvento (beforeSend)', () => {
  it('N · el hash de recuperación y la query desaparecen de la URL; headers/cookies/data/user/migas no viajan', async () => {
    const { limpiarEvento } = await cargar()
    const ev = limpiarEvento({
      event_id: 'e1', timestamp: 1, platform: 'javascript', level: 'error', environment: 'production', release: 'r1',
      message: 'falló para ana@x.mx',
      request: {
        url: 'https://sistema-renovacell.netlify.app/#/recovery?access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk&type=recovery',
        headers: { Authorization: 'Bearer abcdefghijklmnop', Cookie: 'sb=1' },
        cookies: 'sb-access-token=eyJ', data: { password: 'hunter22' },
      },
      user: { id: 'u1', email: 'ana@x.mx', ip_address: '1.2.3.4' },
      breadcrumbs: [{ category: 'fetch', data: { url: 'https://x/rest/v1/profiles?email=eq.ana@x.mx' } }],
      contexts: { os: {} }, extra: { body: { rfc: 'PEGA850101AB1' } },
      tags: { pantalla: 'login', transaction: 'x', email: 'ana@x.mx' },
      exception: { values: [{ type: 'Error', value: 'JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk expired', stacktrace: { frames: [{ filename: 'https://app/x.js?v=1#h', function: 'f', vars: { token: 'abc' } }] } }] },
    })
    expect(ev).not.toBeNull()
    const s = JSON.stringify(ev)
    for (const prohibido of ['recovery', 'access_token', 'eyJ', 'Bearer', 'Cookie', 'sb-access', 'hunter22', 'ana@x.mx', '1.2.3.4', 'profiles?email', 'PEGA850101AB1', '"user"', 'breadcrumbs', 'contexts', 'extra', 'headers', 'cookies', '"data"', 'vars', 'transaction":"x']) {
      expect(s, prohibido).not.toContain(prohibido)
    }
    expect(ev).toMatchObject({
      event_id: 'e1', environment: 'production', release: 'r1',
      message: 'falló para [correo]',
      request: { url: 'https://sistema-renovacell.netlify.app/' },
      tags: { pantalla: 'login' },
    })
    expect(ev!.exception!.values[0].value).toBe('mensaje omitido: contenía datos sensibles')
    expect(ev!.exception!.values[0].stacktrace).toEqual({ frames: [{ filename: 'https://app/x.js', function: 'f' }] })
    expect(Object.keys(ev!).sort()).toEqual(['environment', 'event_id', 'exception', 'level', 'message', 'platform', 'release', 'request', 'tags', 'timestamp'])
  })
  it('un evento sin nada sensible pasa intacto en lo esencial; uno roto se descarta (null) en vez de salir sin limpiar', async () => {
    const { limpiarEvento } = await cargar()
    expect(limpiarEvento({ message: 'Algo salió mal', exception: { values: [{ type: 'TypeError', value: 'x is not a function' }] } })).toEqual({
      message: 'Algo salió mal', exception: { values: [{ type: 'TypeError', value: 'x is not a function' }] },
    })
    const roto = { get message(): string { throw new Error('no') } }
    expect(limpiarEvento(roto as unknown as { message?: unknown })).toBeNull()
  })
})

// W6-A3.3 · Telemetría de errores de las Edge Functions: opcional, fail-open, lista blanca.
//
// Lo que se prueba aquí es la GARANTÍA, no la integración con Sentry: sin DSN no hay
// red; con Sentry caído/lento/500 la función responde igual; ninguna excepción del
// helper escapa; y en el cuerpo que viaja no cabe un token, un correo, un RFC ni el
// cuerpo de respuesta de un proveedor. Además se fija QUÉ sitios de qué funciones
// reportan (y cuáles no: 400/401/403/501 y conflictos de negocio nunca).
import { describe, it, expect } from 'vitest'
import {
  capturar, observador, parseDsn, construirEvento, construirSobre,
  CLAVES_EVENTO, CLAVES_TAGS, CLASIFICACIONES, TIMEOUT_OBSERVA_MS,
  sanitizarTexto, sanitizarCodigo, urlSinSecretos, contieneCredencial, MENSAJE_GENERICO,
  type EventoObserva, type Fetch,
} from '../../../../../supabase/functions/_shared/observa'
import * as sanitizarWeb from '../../lib/sanitizar'
import sanitizarWebSrc from '../../lib/sanitizar.ts?raw'
import observaSrc from '../../../../../supabase/functions/_shared/observa.ts?raw'

const edges = import.meta.glob('../../../../../supabase/functions/*/index.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const edge = (n: string): string => {
  const k = Object.keys(edges).find((p) => p.endsWith(`/${n}/index.ts`))
  if (!k) throw new Error(`no existe la edge ${n}`)
  return edges[k]
}
const soloCodigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

const DSN = 'https://abc123def456@o999.ingest.sentry.io/4507'
const env = (vars: Record<string, string | undefined>) => (k: string) => vars[k]
const CON_DSN = env({ SENTRY_DSN: DSN })
const SIN_DSN = env({})

interface Llamada { url: string; init: RequestInit }
function fakeFetch(status = 200): { fetch: Fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = []
  const fetch: Fetch = async (url, init) => { llamadas.push({ url, init: init ?? {} }); return new Response('', { status }) }
  return { fetch, llamadas }
}
const cuerpoDe = (l: Llamada): string => String(l.init.body)
const eventoDe = (l: Llamada): Record<string, unknown> => JSON.parse(cuerpoDe(l).trim().split('\n')[2])

const EV: EventoObserva = { funcion: 'shipping', accion: 'create_shipment', clasificacion: 'unknown', code: 'create_timeout', error: new Error('network down') }

// ───────────────────────── Sanitizador ─────────────────────────
describe('sanitizarTexto', () => {
  it('Bearer → mensaje genérico (no se intenta recortar alrededor)', () => {
    const r = sanitizarTexto('fallo con Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefg.hijklmn en el header')
    expect(r).toEqual({ texto: MENSAJE_GENERICO, generico: true })
  })
  it('Basic → genérico', () => {
    expect(sanitizarTexto('Basic dXNlcjpwYXNz1234 rechazado').generico).toBe(true)
  })
  it('JWT suelto → genérico', () => {
    expect(sanitizarTexto('token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c').generico).toBe(true)
  })
  it('llaves de proveedor (sk_live_, whsec_) → genérico', () => {
    expect(sanitizarTexto('stripe sk_live_51Habcdefghijklmnop').generico).toBe(true)
    expect(sanitizarTexto('secreto whsec_abcdefghijklmnop1234').generico).toBe(true)
    expect(sanitizarTexto('api_key=ABCDEFGH1234').generico).toBe(true)
    expect(sanitizarTexto('"password": "hunter22"').generico).toBe(true)
  })
  it('hex/base64 largos (llaves, hashes de sesión) → genérico', () => {
    expect(sanitizarTexto('key 0123456789abcdef0123456789abcdef').generico).toBe(true)
    expect(sanitizarTexto('blob QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5QUJDREVGR0g=').generico).toBe(true)
  })
  it('correo, teléfono, RFC y CURP → marcadores', () => {
    const r = sanitizarTexto('doctor ana.perez@clinica.mx tel 6691234567 rfc PEGA850101AB1 curp PEGA850101MSLRRN09')
    expect(r.generico).toBe(false)
    expect(r.texto).not.toMatch(/@/)
    expect(r.texto).not.toMatch(/6691234567/)
    expect(r.texto).not.toMatch(/PEGA850101/)
    expect(r.texto).toContain('[correo]')
    expect(r.texto).toContain('[tel]')
    expect(r.texto).toContain('[rfc]')
    expect(r.texto).toContain('[curp]')
  })
  it('URL: conserva host+ruta, tira query y fragmento', () => {
    const r = sanitizarTexto('GET https://api.dhl.com/v2/rates?account=12345&page=2#frag falló')
    expect(r.texto).toBe('GET https://api.dhl.com/v2/rates falló')
  })
  it('URL con token en query → genérico aunque sea la única señal', () => {
    // La regla de query sensible se evalúa sobre el texto ORIGINAL.
    expect(sanitizarTexto('https://x.mx/cb?access_token=abcd1234').generico).toBe(true)
  })
  it('recorta y colapsa espacios; nunca lanza con entradas raras', () => {
    expect(sanitizarTexto('palabra '.repeat(200)).texto.length).toBe(200)
    expect(sanitizarTexto('  a \n\n b  ').texto).toBe('a b')
    const circular: Record<string, unknown> = {}; circular.yo = circular
    expect(() => sanitizarTexto(circular)).not.toThrow()
    expect(sanitizarTexto(undefined).texto).toBe('')
    expect(sanitizarTexto(new Error('x@y.mx')).texto).toBe('[correo]')
  })
  it('sanitizarCodigo: solo identificadores cortos', () => {
    expect(sanitizarCodigo(502)).toBe('502')
    expect(sanitizarCodigo('fiscal_incierto')).toBe('fiscal_incierto')
    expect(sanitizarCodigo('texto con espacios')).toBeUndefined()
    expect(sanitizarCodigo('a@b.mx')).toBeUndefined()
    expect(sanitizarCodigo(null)).toBeUndefined()
  })
  it('urlSinSecretos: quita query y hash; descarta si la ruta trae credencial', () => {
    expect(urlSinSecretos('https://app.mx/#/recovery?token=eyJ.abc.def')).toBe('https://app.mx/')
    expect(urlSinSecretos('https://app.mx/x?code=123')).toBe('https://app.mx/x')
    expect(urlSinSecretos('https://app.mx/sk_live_abcdefghijklmnop/x')).toBeUndefined()
    expect(urlSinSecretos(42)).toBeUndefined()
  })
  it('la copia del frontend es el MISMO sanitizador (fuente y comportamiento)', () => {
    const seccion = (s: string) => s.slice(s.indexOf('// ── SANITIZADOR (inicio)'), s.indexOf('// ── SANITIZADOR (fin)'))
    expect(seccion(observaSrc).length).toBeGreaterThan(500)
    expect(seccion(sanitizarWebSrc)).toBe(seccion(observaSrc))
    const vectores = ['Bearer abcdefghijklmnop', 'ana@x.mx 6691234567', 'https://a.mx/p?q=1#h', 'PEGA850101AB1', 'normal']
    for (const v of vectores) {
      expect(sanitizarWeb.sanitizarTexto(v)).toEqual(sanitizarTexto(v))
      expect(sanitizarWeb.urlSinSecretos(v)).toEqual(urlSinSecretos(v))
      expect(sanitizarWeb.contieneCredencial(v)).toEqual(contieneCredencial(v))
    }
  })
})

// ───────────────────────── DSN ─────────────────────────
describe('parseDsn', () => {
  it('acepta el formato de Sentry y arma el endpoint de envelope', () => {
    expect(parseDsn(DSN)).toEqual({ endpoint: 'https://o999.ingest.sentry.io/api/4507/envelope/', llave: 'abc123def456' })
    expect(parseDsn('https://k1@sentry.mi-empresa.mx/path/12')).toEqual({ endpoint: 'https://sentry.mi-empresa.mx/path/api/12/envelope/', llave: 'k1' })
  })
  it('rechaza DSN inválidos (sin llave, sin proyecto, no URL, otro esquema)', () => {
    for (const d of [undefined, '', 'no-es-url', 'https://host/123', 'https://k@host/', 'https://k@host/abc', 'ftp://k@host/1', '   ']) {
      expect(parseDsn(d as string | undefined)).toBeNull()
    }
  })
})

// ───────────────────────── capturar: fail-open ─────────────────────────
describe('capturar · sin DSN / DSN inválido', () => {
  it('A · sin SENTRY_DSN: 0 llamadas de red, resultado "omitido"', async () => {
    const f = fakeFetch()
    await expect(capturar(EV, { fetch: f.fetch, env: SIN_DSN, waitUntil: null })).resolves.toBe('omitido')
    expect(f.llamadas).toHaveLength(0)
  })
  it('B · DSN inválido: 0 llamadas, "omitido", no lanza', async () => {
    const f = fakeFetch()
    for (const dsn of ['basura', 'https://host/1', 'https://k@host/x']) {
      await expect(capturar(EV, { fetch: f.fetch, env: env({ SENTRY_DSN: dsn }), waitUntil: null })).resolves.toBe('omitido')
    }
    expect(f.llamadas).toHaveLength(0)
  })
})

describe('capturar · Sentry caído, lento o roto', () => {
  it('C · timeout: resuelve "fallido" dentro del tope, nunca rechaza', async () => {
    const fetch: Fetch = (_u, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    })
    const t0 = Date.now()
    await expect(capturar(EV, { fetch, env: CON_DSN, waitUntil: null, timeoutMs: 120 })).resolves.toBe('fallido')
    expect(Date.now() - t0).toBeLessThan(1000)
  })
  it('D · 500 del proveedor → "fallido", sin excepción', async () => {
    const f = fakeFetch(500)
    await expect(capturar(EV, { fetch: f.fetch, env: CON_DSN, waitUntil: null })).resolves.toBe('fallido')
    expect(f.llamadas).toHaveLength(1)
  })
  it('D2 · fetch que rechaza (DNS, red) → "fallido"', async () => {
    const fetch: Fetch = async () => { throw new TypeError('fetch failed') }
    await expect(capturar(EV, { fetch, env: CON_DSN, waitUntil: null })).resolves.toBe('fallido')
  })
  it('E · nada del helper escapa: fetch que lanza síncrono, env que lanza, id que lanza, waitUntil que lanza', async () => {
    const lanza = () => { throw new Error('boom') }
    await expect(capturar(EV, { fetch: lanza as unknown as Fetch, env: CON_DSN, waitUntil: null })).resolves.toBe('fallido')
    await expect(capturar(EV, { fetch: fakeFetch().fetch, env: lanza, waitUntil: null })).resolves.toBe('fallido')
    await expect(capturar(EV, { fetch: fakeFetch().fetch, env: CON_DSN, waitUntil: null, idEvento: lanza })).resolves.toBe('fallido')
    await expect(capturar(EV, { fetch: fakeFetch().fetch, env: CON_DSN, waitUntil: lanza })).resolves.toBe('encolado')
    // Evento malformado tampoco rompe.
    await expect(capturar({} as unknown as EventoObserva, { fetch: fakeFetch().fetch, env: CON_DSN, waitUntil: null })).resolves.toBe('enviado')
    expect(() => observador('x', { fetch: lanza as unknown as Fetch, env: CON_DSN, waitUntil: null })('a', 'unknown')).not.toThrow()
  })
  it('el tope de timeout está acotado (100 ms … 5 s; por defecto 1.5 s)', () => {
    expect(TIMEOUT_OBSERVA_MS).toBe(1500)
    expect(observaSrc).toMatch(/Math\.max\(100, Math\.min\(deps\.timeoutMs \?\? TIMEOUT_OBSERVA_MS, 5000\)\)/)
  })
})

// ───────────────────────── fire-and-forget ─────────────────────────
describe('capturar · fire-and-forget', () => {
  it('P · con EdgeRuntime.waitUntil: "encolado" de inmediato y el envío queda registrado', async () => {
    const f = fakeFetch()
    const registradas: Promise<unknown>[] = []
    const r = await capturar(EV, { fetch: f.fetch, env: CON_DSN, waitUntil: (p) => { registradas.push(p) } })
    expect(r).toBe('encolado')
    expect(registradas).toHaveLength(1)
    await expect(registradas[0]).resolves.toBe('enviado')
    expect(f.llamadas).toHaveLength(1)
  })
  it('P2 · sin waitUntil: resuelve cuando termina el envío acotado', async () => {
    const f = fakeFetch()
    await expect(capturar(EV, { fetch: f.fetch, env: CON_DSN, waitUntil: null })).resolves.toBe('enviado')
  })
  it('P3 · el helper detecta EdgeRuntime.waitUntil del runtime cuando no se inyecta', async () => {
    const g = globalThis as { EdgeRuntime?: unknown }
    const registradas: Promise<unknown>[] = []
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { registradas.push(p) } }
    try {
      const f = fakeFetch()
      await expect(capturar(EV, { fetch: f.fetch, env: CON_DSN })).resolves.toBe('encolado')
      expect(registradas).toHaveLength(1)
    } finally { delete g.EdgeRuntime }
  })
})

// ───────────────────────── lista blanca del cuerpo ─────────────────────────
describe('capturar · lo que viaja', () => {
  it('Q · el evento solo tiene claves permitidas; tags solo las permitidas', async () => {
    const f = fakeFetch()
    await capturar(EV, { fetch: f.fetch, env: env({ SENTRY_DSN: DSN, SENTRY_RELEASE: 'w6a3', SENTRY_ENVIRONMENT: 'prod' }), waitUntil: null })
    const ev = eventoDe(f.llamadas[0])
    for (const k of Object.keys(ev)) expect(CLAVES_EVENTO).toContain(k)
    for (const k of Object.keys(ev.tags as object)) expect(CLAVES_TAGS).toContain(k)
    expect(ev).toMatchObject({ platform: 'javascript', level: 'error', logger: 'edge', environment: 'prod', release: 'w6a3', tags: { funcion: 'shipping', accion: 'create_shipment', clasificacion: 'unknown', code: 'create_timeout' } })
    expect(ev.exception).toEqual({ values: [{ type: 'Error', value: 'network down' }] })
    expect(f.llamadas[0].url).toBe('https://o999.ingest.sentry.io/api/4507/envelope/')
    expect((f.llamadas[0].init.headers as Record<string, string>)['X-Sentry-Auth']).toMatch(/sentry_version=7, sentry_client=renovacell-edge\/1, sentry_key=abc123def456$/)
    expect(f.llamadas[0].init.method).toBe('POST')
    expect(f.llamadas[0].init.signal).toBeInstanceOf(AbortSignal)
  })
  it('la clasificación operativa viaja tal cual y no se reinterpreta (unknown ≠ failed)', async () => {
    for (const c of CLASIFICACIONES) {
      const f = fakeFetch()
      await capturar({ ...EV, clasificacion: c }, { fetch: f.fetch, env: CON_DSN, waitUntil: null })
      expect((eventoDe(f.llamadas[0]).tags as { clasificacion: string }).clasificacion).toBe(c)
    }
    const f = fakeFetch()
    await capturar({ ...EV, clasificacion: 'fatal' as 'unknown' }, { fetch: f.fetch, env: CON_DSN, waitUntil: null })
    expect((eventoDe(f.llamadas[0]).tags as { clasificacion: string }).clasificacion).toBe('internal_error')
  })
  it('F/G/H/I · correo, Bearer, JWT y query de URL NUNCA aparecen en el cuerpo', async () => {
    const casos = [
      'no se pudo notificar a ana.perez@clinica.mx',
      'DHL 401: Authorization Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      'POST https://api.facturama.mx/cfdi?Email=ana@x.mx&token=abcd falló',
      'sk_live_51Habcdefghijklmnop',
      'RFC PEGA850101AB1 cel 6691234567',
    ]
    for (const m of casos) {
      const f = fakeFetch()
      await capturar({ ...EV, error: new Error(m) }, { fetch: f.fetch, env: CON_DSN, waitUntil: null })
      const cuerpo = cuerpoDe(f.llamadas[0])
      expect(cuerpo).not.toMatch(/@/)
      expect(cuerpo).not.toMatch(/Bearer/i)
      expect(cuerpo).not.toMatch(/eyJ[A-Za-z0-9_-]+\./)
      expect(cuerpo).not.toMatch(/[?&](Email|token)=/)
      expect(cuerpo).not.toMatch(/sk_live/)
      expect(cuerpo).not.toMatch(/PEGA850101|6691234567/)
    }
  })
  it('J · un error con cuerpo del proveedor, headers o request adjuntos NO los arrastra', async () => {
    const f = fakeFetch()
    const errorGordo = Object.assign(new Error('Facturama 500'), {
      response: { body: { Message: 'RFC XAXX010101000 inválido', Email: 'ana@x.mx' } },
      request: { headers: { Authorization: 'Basic dXNlcjpwYXNz' }, body: '{"Receiver":{"Rfc":"PEGA850101AB1"}}' },
      config: { headers: { apikey: 'service-role-key-xyz' } },
    })
    await capturar({ ...EV, error: errorGordo }, { fetch: f.fetch, env: CON_DSN, waitUntil: null })
    const cuerpo = cuerpoDe(f.llamadas[0])
    for (const prohibido of ['XAXX010101000', 'ana@x.mx', 'Basic', 'PEGA850101AB1', 'service-role', 'Receiver', 'apikey', 'headers']) {
      expect(cuerpo).not.toContain(prohibido)
    }
    expect(eventoDe(f.llamadas[0]).exception).toEqual({ values: [{ type: 'Error', value: 'Facturama 500' }] })
  })
  it('un mensaje con credencial viaja como genérico, pero código y clase sí', async () => {
    const f = fakeFetch()
    await capturar({ funcion: 'cfdi-send', accion: 'enviar', clasificacion: 'provider_error', code: 502, error: Object.assign(new TypeError('Bearer abcdefghijklmnopqrstu'), { name: 'TypeError' }) }, { fetch: f.fetch, env: CON_DSN, waitUntil: null })
    const ev = eventoDe(f.llamadas[0])
    expect(ev.exception).toEqual({ values: [{ type: 'TypeError', value: MENSAJE_GENERICO }] })
    expect(ev.tags).toEqual({ funcion: 'cfdi-send', accion: 'enviar', clasificacion: 'provider_error', code: '502' })
  })
  it('construirEvento / construirSobre: event_id de 32 hex, sobre de 3 líneas', () => {
    const ev = construirEvento(EV, SIN_DSN, new Date('2026-10-05T12:00:00Z'), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(ev.event_id).toBe('aaaaaaaabbbbccccddddeeeeeeeeeeee')
    expect(ev.timestamp).toBe('2026-10-05T12:00:00.000Z')
    expect(ev.release).toBeUndefined()
    const sobre = construirSobre(ev, parseDsn(DSN)!)
    const lineas = sobre.body.trim().split('\n')
    expect(lineas).toHaveLength(3)
    expect(JSON.parse(lineas[0])).toEqual({ event_id: ev.event_id, sent_at: ev.timestamp })
    expect(JSON.parse(lineas[1])).toEqual({ type: 'event', content_type: 'application/json' })
  })
})

// ───────────────────────── el helper no toca nada más ─────────────────────────
describe('observa.ts · aislamiento', () => {
  it('no lee request, headers, cookies, JWT ni llaves de Supabase; no importa clientes', () => {
    const src = soloCodigo(observaSrc)
    for (const prohibido of [/req\./, /headers\.get/, /cookie/i, /SUPABASE_SERVICE_ROLE_KEY/, /SUPABASE_ANON_KEY/, /FACTURAMA/, /STRIPE/, /createClient/, /jsr:@supabase/, /stack/]) {
      expect(src).not.toMatch(prohibido)
    }
    // Solo estas variables de entorno.
    const envs = [...src.matchAll(/env\('([A-Z_]+)'\)/g)].map((m) => m[1]).sort()
    expect([...new Set(envs)]).toEqual(['SENTRY_DSN', 'SENTRY_ENVIRONMENT', 'SENTRY_RELEASE'])
  })
})

// ───────────────────────── instrumentación de las Edge Functions ─────────────────────────
const INSTRUMENTADAS: Record<string, number> = {
  shipping: 11, 'cfdi-send': 1, 'cfdi-cancel': 4, 'cfdi-cancel-status': 2, 'cfdi-download': 1,
  'comm-dispatch': 3, 'staff-admin': 2, 'register-doctor': 3, 'verify-cedula': 2,
  'stripe-webhook': 3, 'meta-webhook': 1, 'report-transfer': 1,
}
const NO_INSTRUMENTADAS = ['assistant', 'cfdi', 'invite-doctor', 'stripe-checkout', 'meta-send', 'capture-lead']

describe('Edge Functions · qué reporta y qué no', () => {
  it('K0 · cada función instrumentada importa el helper y llama exactamente los sitios auditados (sin doble captura)', () => {
    for (const [fn, n] of Object.entries(INSTRUMENTADAS)) {
      const src = soloCodigo(edge(fn))
      expect(src, fn).toContain("import { observador } from '../_shared/observa.ts'")
      expect(src, fn).toContain(`const obs = observador('${fn}')`)
      expect((src.match(/\bobs\(/g) ?? []).length, `${fn}: llamadas a obs`).toBe(n)
      // Cada línea reporta a lo sumo una vez.
      for (const l of src.split('\n')) expect((l.match(/\bobs\(/g) ?? []).length, `${fn}: ${l.trim().slice(0, 80)}`).toBeLessThanOrEqual(1)
    }
  })
  it('K1 · assistant y las demás NO instrumentadas no cargan el helper', () => {
    for (const fn of NO_INSTRUMENTADAS) {
      expect(edge(fn), fn).not.toMatch(/_shared\/observa/)
    }
    const total = Object.keys(edges).length
    expect(total).toBeGreaterThanOrEqual(Object.keys(INSTRUMENTADAS).length + NO_INSTRUMENTADAS.length)
  })
  it('K2 · nunca se espera el envío (sin `await obs(` ni `await capturar(`) y solo clasificaciones válidas', () => {
    for (const fn of Object.keys(INSTRUMENTADAS)) {
      const src = soloCodigo(edge(fn))
      expect(src, fn).not.toMatch(/await\s+(obs|capturar)\(/)
      expect(src, fn).not.toMatch(/\bcapturar\(/)
      for (const m of src.matchAll(/\bobs\([^,]+,\s*'([a-z_]+)'/g)) expect(CLASIFICACIONES, `${fn}: ${m[1]}`).toContain(m[1])
    }
  })
  it('K3 · respuestas esperadas (400/401/403/405/501 not_configured, conflictos de negocio) no se reportan', () => {
    for (const fn of Object.keys(INSTRUMENTADAS)) {
      for (const l of soloCodigo(edge(fn)).split('\n')) {
        if (!/\bobs\(/.test(l)) continue
        expect(l, `${fn}: ${l.trim().slice(0, 100)}`).not.toMatch(/json\((400|401|403|404|405|422|423|501)\b/)
        // 409 solo cuando es un resultado DESCONOCIDO (contrato del cliente), nunca un conflicto de negocio.
        if (/json\(409\b/.test(l)) expect(l, fn).toMatch(/unknown_requires_reconciliation/)
        expect(l, fn).not.toMatch(/not_configured|NO_AUTORIZADO|CUENTA_SUSPENDIDA|already_requested|Firma inválida/)
      }
    }
  })
  it('K4 · el mensaje nunca es el cuerpo del proveedor ni un dato del request', () => {
    for (const fn of Object.keys(INSTRUMENTADAS)) {
      for (const l of soloCodigo(edge(fn)).split('\n')) {
        if (!/\bobs\(/.test(l)) continue
        const llamada = l.slice(l.indexOf('obs('))
        const args = llamada.slice(0, llamada.indexOf('})') + 2)
        expect(args, `${fn}: ${args}`).not.toMatch(/dhlErrorMessage|d\?\.|x\?\.|data\b|shipData|rd\b|body\.|payload\.|email|orderId|session|authHeader|headers/)
      }
    }
  })
  it('L · shipping: cada markUnknown lleva un reporte `unknown` y cada 502 de DHL uno `provider_error`', () => {
    const src = soloCodigo(edge('shipping'))
    const markUnknown = (src.match(/await markUnknown\(/g) ?? []).length
    const unknown = (src.match(/obs\('[a-z_]+', 'unknown'/g) ?? []).length
    expect(markUnknown).toBe(3)
    expect(unknown).toBe(markUnknown)
    const provider = (src.match(/obs\('[a-z_]+', 'provider_error'/g) ?? []).length
    expect(provider).toBe(8)
  })
  it('L2 · fiscal: incierto → unknown; persistencia → internal_error; 502 Facturama → provider_error', () => {
    const cancel = soloCodigo(edge('cfdi-cancel'))
    expect(cancel).toMatch(/obs\('cancelar', 'unknown', \{ code: 'fiscal_incierto'/)
    expect(cancel).toMatch(/obs\('cancelar', 'internal_error', \{ code: 'persist_after_cancel'/)
    expect(cancel).toMatch(/obs\('cancelar', 'internal_error', \{ code: 'claim_failed'/)
    expect(cancel).toMatch(/obs\('cancelar', 'provider_error', \{ code: r\.status/)
    expect(soloCodigo(edge('cfdi-cancel-status'))).toMatch(/obs\('consultar', 'internal_error', \{ code: 'persist'/)
    expect(soloCodigo(edge('cfdi-send'))).toMatch(/obs\('enviar', 'provider_error', \{ code: r\.status/)
    expect(soloCodigo(edge('cfdi-download'))).toMatch(/obs\('descargar', 'provider_error'/)
  })
  it('L3 · staff-admin: revocación/readmisión de Auth fallida → internal_error; comm/webhooks → internal_error/unknown', () => {
    const staff = soloCodigo(edge('staff-admin'))
    expect(staff).toMatch(/if \(!sesionesRevocadas\) obs\(action, 'internal_error', \{ code: 'auth_revocation_failed'/)
    expect(staff).toMatch(/if \(!readmitido\) obs\(action, 'internal_error', \{ code: 'auth_readmission_failed'/)
    const comm = soloCodigo(edge('comm-dispatch'))
    expect(comm).toMatch(/if \(!negado\) obs\('reclamar', 'internal_error'/)
    expect(comm).toMatch(/if \(eRes\) obs\('resolver', 'internal_error'/)
    expect(comm).toMatch(/resultado === 'incierto'\) obs\('enviar', 'unknown'/)
    expect(comm).not.toMatch(/resultado === 'fallido'\) obs/)
    const stripe = soloCodigo(edge('stripe-webhook'))
    for (const c of ['db_read_error', 'rpc_error', 'db_update_error']) expect(stripe).toMatch(new RegExp(`obs\\('checkout', 'internal_error', \\{ code: '${c}'`))
    const meta = soloCodigo(edge('meta-webhook'))
    expect(meta).toMatch(/obs\('procesar', 'internal_error', \{ code: 'exception', error: e \}\)\n\s*throw e/)
    expect(soloCodigo(edge('report-transfer'))).toMatch(/else obs\('comprobante', 'internal_error', \{ code: 'proof_upload_failed'/)
    for (const fn of ['register-doctor', 'verify-cedula']) expect(soloCodigo(edge(fn)), fn).toMatch(/obs\('sep', 'provider_error', \{ code: r\.status \}\)/)
    expect(soloCodigo(edge('register-doctor'))).toMatch(/obs\('crear_cuenta', 'internal_error', \{ code: 'create_user'/)
  })
  it('M · las verdades operativas no cambian: los sitios reportan y luego devuelven/persisten lo mismo que antes', () => {
    const ship = soloCodigo(edge('shipping'))
    // Reportar antecede a markUnknown/failAttempt en la misma sentencia; el retorno sigue siendo 409/502.
    expect(ship).toMatch(/obs\('create_shipment', 'unknown', \{ code: 'sin_tracking'[^\n]*await markUnknown\(admin, attemptId, 'DHL 2xx sin tracking'\); return json\(409, \{ error: 'unknown_requires_reconciliation'/)
    expect(ship).toMatch(/obs\('create_shipment', 'unknown', \{ code: 'finalize_failed'[^\n]*await markUnknown\(admin, attemptId, `finalize: \$\{finErr\.message\}`\); return json\(409/)
    expect(ship).toMatch(/obs\('create_shipment', 'provider_error', \{ code: shipResp\.status[^\n]*await failAttempt\(admin, attemptId, dhlErrorMessage\(shipResp\.status, shipData\)\); return json\(502/)
    const cancel = soloCodigo(edge('cfdi-cancel'))
    expect(cancel).toMatch(/return json\(502, \{ error: 'fiscal_incierto'/)
    expect(cancel).toMatch(/return json\(500, \{ error: 'persist_after_cancel'/)
    const stripe = soloCodigo(edge('stripe-webhook'))
    expect(stripe).toMatch(/return new Response\('rpc_error', \{ status: 500 \}\)/)
    expect(stripe).toMatch(/return ok\(\{ received: true, ignored: 'already_recorded' \}\)/)
  })
})

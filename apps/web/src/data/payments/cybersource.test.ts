// CS-1A.2 · cliente REST CyberSource: firma HTTP Signature con vectores deterministas (HMAC y SHA-256 calculados de forma independiente
// con Web Crypto en la prueba, sobre la cadena canónica afirmada literalmente), canonicalización, Digest sobre los bytes exactos, GET sin digest, ambientes, rechazos de configuración, errores HTTP,
// timeout = resultado desconocido, cero reintentos y ninguna fuga de secretos. Sin red: el transporte se inyecta.
import { describe, it, expect } from 'vitest'
import src from '../../../../../supabase/functions/_shared/cybersource.ts?raw'
import {
  csConfig, HOSTS_CS, PRODUCCION_CS_HABILITADA, CS_SECRETOS, CS_SECRETOS_LIVE, RUTAS_CS, RUTAS_FINANCIERAS_CS, describirCS, fechaHttpCS,
  cuerpoBytesCS, digestCS, cadenaFirmaCS, listaCabecerasFirmadasCS, firmarCS, depurarCS, mensajeErrorCS, solicitarCS, TIMEOUT_CS_MS, type ConfigCS,
} from '../../../../../supabase/functions/_shared/cybersource'

// Utilidades de referencia INDEPENDIENTES del módulo (Web Crypto + btoa), para calcular los vectores esperados.
const te = new TextEncoder()
const b64 = (u: ArrayBuffer | Uint8Array) => { const a = u instanceof Uint8Array ? u : new Uint8Array(u); let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s) }
const unb64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0))
const utf8 = (u: Uint8Array) => new TextDecoder().decode(u)
const sha256b64 = async (bytes: Uint8Array | string) => b64(await crypto.subtle.digest('SHA-256', (typeof bytes === 'string' ? te.encode(bytes) : bytes) as BufferSource))
const SECRET = btoa('renovacell-cs1a2-vector-de-prueba-0123456789')   // base64 válido, solo para pruebas
const env = (o: Record<string, string>) => (k: string) => o[k]
const OK = { CS_API_ENV: 'test', CS_MERCHANT_ID: 'renovacell_mx', CS_KEY_ID: '9a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d', CS_SHARED_SECRET: SECRET }
const FECHA = new Date('2026-10-20T15:04:05Z')
const cfgOk = (): ConfigCS => { const c = csConfig(env(OK)); if (!c.ok) throw new Error(c.detalle); return c.cfg }
const hmac = async (cadena: string) => {
  const k = await crypto.subtle.importKey('raw', unb64(SECRET) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64(await crypto.subtle.sign('HMAC', k, te.encode(cadena) as BufferSource))
}

describe('CS-1A.2 · configuración y ambientes', () => {
  it('sandbox: host del registro, nunca de una variable; producción deshabilitada por código', () => {
    const c = csConfig(env(OK)); expect(c.ok).toBe(true); if (!c.ok) return
    expect(c.cfg).toEqual({ ambiente: 'test', host: 'apitest.cybersource.com', merchantId: 'renovacell_mx', keyId: OK.CS_KEY_ID, sharedSecret: SECRET })
    expect(HOSTS_CS).toEqual({ test: 'apitest.cybersource.com', production: 'api.cybersource.com' })
    expect(PRODUCCION_CS_HABILITADA).toBe(false)
    expect(CS_SECRETOS).toEqual(['CS_API_ENV', 'CS_MERCHANT_ID', 'CS_KEY_ID', 'CS_SHARED_SECRET'])
    expect(CS_SECRETOS_LIVE).toEqual(['CS_API_ENV', 'CS_LIVE_MERCHANT_ID', 'CS_LIVE_KEY_ID', 'CS_LIVE_SHARED_SECRET'])
    expect(csConfig(env({ CS_API_ENV: 'production', CS_LIVE_MERCHANT_ID: 'm', CS_LIVE_KEY_ID: 'k', CS_LIVE_SHARED_SECRET: SECRET }))).toMatchObject({ ok: false, motivo: 'produccion_deshabilitada' })
    // aun habilitada, producción exige SUS secretos (los de sandbox no sirven) y usa su host
    expect(csConfig(env({ ...OK, CS_API_ENV: 'production' }), true)).toMatchObject({ ok: false, motivo: 'sin_configurar', detalle: 'Faltan CS_LIVE_MERCHANT_ID, CS_LIVE_KEY_ID, CS_LIVE_SHARED_SECRET.' })
    const live = csConfig(env({ CS_API_ENV: 'production', CS_LIVE_MERCHANT_ID: 'renovacell_live', CS_LIVE_KEY_ID: 'kid-live-0001', CS_LIVE_SHARED_SECRET: SECRET }), true)
    expect(live.ok && live.cfg.host).toBe('api.cybersource.com')
  })
  it('rechaza ausente, incompleta, relleno, ambiente inválido y secreto que no es base64', () => {
    expect(csConfig(env({}))).toMatchObject({ ok: false, motivo: 'sin_configurar' })
    expect(csConfig(env({ ...OK, CS_KEY_ID: '' }))).toMatchObject({ ok: false, motivo: 'sin_configurar', detalle: 'Faltan CS_KEY_ID.' })
    expect(csConfig(env({ ...OK, CS_SHARED_SECRET: '...' }))).toMatchObject({ ok: false, motivo: 'relleno' })
    expect(csConfig(env({ ...OK, CS_MERCHANT_ID: '<tu merchant>' }))).toMatchObject({ ok: false, motivo: 'relleno' })
    expect(csConfig(env({ ...OK, CS_API_ENV: 'sandbox' }))).toMatchObject({ ok: false, motivo: 'ambiente_invalido' })
    expect(csConfig(env({ ...OK, CS_SHARED_SECRET: 'no-es-base64-!!-pero-largo-suficiente' }))).toMatchObject({ ok: false, motivo: 'secreto_invalido' })
    for (const r of [csConfig(env({ ...OK, CS_SHARED_SECRET: '...' })), csConfig(env({ ...OK, CS_SHARED_SECRET: 'no-es-base64-!!-pero-largo-suficiente' }))]) {
      expect(JSON.stringify(r)).not.toContain('no-es-base64')
    }
    expect(describirCS(cfgOk())).toBe('cybersource test · apitest.cybersource.com · merchant renovacell_mx · key …4c5d')
    expect(describirCS(cfgOk())).not.toContain(SECRET)
  })
})

describe('CS-1A.2 · HTTP Signature', () => {
  it('POST: canonicalización exacta, Digest sobre los bytes exactos y firma idéntica al vector HMAC independiente', async () => {
    const cfg = cfgOk()
    const cuerpo = { clientReferenceInformation: { code: 'S100002' }, orderInformation: { amountDetails: { totalAmount: '6000.00', currency: 'MXN' } } }
    const bytes = cuerpoBytesCS(cuerpo)
    expect(utf8(bytes)).toBe(JSON.stringify(cuerpo))
    const digestEsperado = 'SHA-256=' + await sha256b64(bytes)
    expect(await digestCS(bytes)).toBe(digestEsperado)
    const f = await firmarCS(cfg, 'POST', RUTAS_CS.pagos, bytes, FECHA)
    expect(fechaHttpCS(FECHA)).toBe('Tue, 20 Oct 2026 15:04:05 GMT')
    expect(f.cadena).toBe(
      'host: apitest.cybersource.com\n' +
      'date: Tue, 20 Oct 2026 15:04:05 GMT\n' +
      'request-target: post /pts/v2/payments\n' +
      `digest: ${digestEsperado}\n` +
      'v-c-merchant-id: renovacell_mx')
    expect(f.cadena.endsWith('\n')).toBe(false)
    const sig = await hmac(f.cadena)
    expect(f.headers).toEqual({
      'v-c-merchant-id': 'renovacell_mx',
      'Date': 'Tue, 20 Oct 2026 15:04:05 GMT',
      'Host': 'apitest.cybersource.com',
      'Digest': digestEsperado,
      'Signature': `keyid="${OK.CS_KEY_ID}", algorithm="HmacSHA256", headers="host date request-target digest v-c-merchant-id", signature="${sig}"`,
      'Content-Type': 'application/json;charset=utf-8',
      'Accept': 'application/json;charset=utf-8',
    })
    // un byte distinto en el cuerpo cambia Digest y firma (el Digest es sobre lo que viaja, no sobre un objeto)
    const f2 = await firmarCS(cfg, 'POST', RUTAS_CS.pagos, cuerpoBytesCS({ ...cuerpo, extra: 1 }), FECHA)
    expect(f2.headers.Digest).not.toBe(f.headers.Digest); expect(f2.headers.Signature).not.toBe(f.headers.Signature)
  })
  it('GET: sin Digest y con la lista de cabeceras de GET; la firma coincide con el vector', async () => {
    const cfg = cfgOk()
    const f = await firmarCS(cfg, 'GET', RUTAS_CS.transaccion('6230000000000001'), new Uint8Array(0), FECHA)
    expect(f.digest).toBeNull(); expect(f.headers.Digest).toBeUndefined()
    expect(f.cadena).toBe('host: apitest.cybersource.com\ndate: Tue, 20 Oct 2026 15:04:05 GMT\nrequest-target: get /tss/v2/transactions/6230000000000001\nv-c-merchant-id: renovacell_mx')
    expect(listaCabecerasFirmadasCS('GET')).toBe('host date request-target v-c-merchant-id')
    expect(f.headers.Signature).toContain(`headers="host date request-target v-c-merchant-id", signature="${await hmac(f.cadena)}"`)
    expect(() => cadenaFirmaCS(cfg, 'POST', '/x', 'd', null)).toThrow('digest requerido')
    await expect(firmarCS(cfg, 'GET', 'sin-barra', new Uint8Array(0), FECHA)).rejects.toThrow('ruta inválida')
  })
  it('producción y sandbox firman contra hosts distintos (misma receta)', async () => {
    const live = csConfig(env({ CS_API_ENV: 'production', CS_LIVE_MERCHANT_ID: 'renovacell_mx', CS_LIVE_KEY_ID: OK.CS_KEY_ID, CS_LIVE_SHARED_SECRET: SECRET }), true)
    expect(live.ok).toBe(true); if (!live.ok) return
    const a = await firmarCS(cfgOk(), 'GET', '/tss/v2/transactions/1', new Uint8Array(0), FECHA)
    const b = await firmarCS(live.cfg, 'GET', '/tss/v2/transactions/1', new Uint8Array(0), FECHA)
    expect(a.headers.Host).toBe('apitest.cybersource.com'); expect(b.headers.Host).toBe('api.cybersource.com')
    expect(a.headers.Signature).not.toBe(b.headers.Signature)
  })
})

type Llamada = { url: string; init: RequestInit }
const transporte = (resp: () => Response | Promise<Response>) => {
  const llamadas: Llamada[] = []
  const f = (async (url: string | URL | Request, init?: RequestInit) => { llamadas.push({ url: String(url), init: init ?? {} }); return resp() }) as unknown as typeof fetch
  return { f, llamadas }
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('CS-1A.2 · transporte', () => {
  it('éxito: URL del host del ambiente, cuerpo = bytes firmados, correlation id, y 201 NO se interpreta como pago', async () => {
    const { f, llamadas } = transporte(() => json(201, { id: '7000000000000000001', status: 'AUTHORIZED' }, { 'v-c-correlation-id': 'corr-1' }))
    const r = await solicitarCS<{ id: string; status: string }>(cfgOk(), { metodo: 'POST', ruta: RUTAS_CS.pagos, cuerpo: { a: 1 }, fetchImpl: f, ahora: () => FECHA })
    expect(r).toMatchObject({ ok: true, status: 201, data: { id: '7000000000000000001', status: 'AUTHORIZED' }, correlationId: 'corr-1' })
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].url).toBe('https://apitest.cybersource.com/pts/v2/payments')
    const h = llamadas[0].init.headers as Record<string, string>
    expect(utf8(llamadas[0].init.body as Uint8Array)).toBe('{"a":1}')
    expect(h.Digest).toBe('SHA-256=' + await sha256b64('{"a":1}'))
    expect(Object.keys(r as object)).not.toContain('pagado')   // el cliente no decide: solo entrega status y data
  })
  it('error HTTP: resultado CONOCIDO con mensaje depurado; el cuerpo crudo no se repite en el mensaje', async () => {
    const { f } = transporte(() => json(400, { status: 'INVALID_REQUEST', reason: 'DUPLICATE_REQUEST', message: 'Declined - The transaction identifier sent with this request has already been used in the last 60 days. card 4111111111111111 doc@x.mx' }))
    const r = await solicitarCS(cfgOk(), { metodo: 'POST', ruta: RUTAS_CS.pagos, cuerpo: {}, fetchImpl: f })
    expect(r.ok).toBe(false); if (r.ok) return
    expect(r.clase).toBe('http'); if (r.clase !== 'http') return
    expect(r.status).toBe(400)
    expect(r.mensaje).toContain('CyberSource 400: INVALID_REQUEST · DUPLICATE_REQUEST')
    expect(r.mensaje).not.toMatch(/4111111111111111|doc@x\.mx/)
    const r5 = await solicitarCS(cfgOk(), { metodo: 'GET', ruta: RUTAS_CS.transaccion('1'), fetchImpl: transporte(() => new Response('<html>Bad Gateway</html>', { status: 502 })).f })
    expect(r5).toMatchObject({ ok: false, clase: 'http', status: 502, mensaje: 'CyberSource respondió 502.', data: { raw: '<html>Bad Gateway</html>' } })
  })
  it('timeout tras enviar = RESULTADO DESCONOCIDO (no rechazo) y UNA sola llamada: cero reintentos', async () => {
    const { f, llamadas } = transporte(() => new Promise<Response>((_, rej) => { setTimeout(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), 30) }))
    const r = await solicitarCS(cfgOk(), { metodo: 'POST', ruta: RUTAS_CS.pagos, cuerpo: { b: 2 }, fetchImpl: f, timeoutMs: 10 })
    expect(r).toMatchObject({ ok: false, clase: 'resultado_desconocido', motivo: 'timeout' })
    expect(llamadas).toHaveLength(1)
    const { f: f2, llamadas: l2 } = transporte(() => { throw new TypeError('fetch failed: ECONNRESET') })
    const r2 = await solicitarCS(cfgOk(), { metodo: 'POST', ruta: RUTAS_CS.pagos, cuerpo: { b: 2 }, fetchImpl: f2 })
    expect(r2).toMatchObject({ ok: false, clase: 'resultado_desconocido', motivo: 'red' })
    expect(l2).toHaveLength(1)
    expect(RUTAS_FINANCIERAS_CS).toEqual(['/pts/v2/payments', '/pts/v2/reversals'])
    expect(TIMEOUT_CS_MS).toEqual({ consulta: 15000, financiera: 30000 })
  })
  it('fallos antes de enviar no tocan la red: GET con cuerpo, ruta inválida', async () => {
    const { f, llamadas } = transporte(() => json(200, {}))
    expect(await solicitarCS(cfgOk(), { metodo: 'GET', ruta: '/tss/v2/transactions/1', cuerpo: { x: 1 }, fetchImpl: f })).toMatchObject({ ok: false, clase: 'antes_de_enviar' })
    expect(await solicitarCS(cfgOk(), { metodo: 'POST', ruta: 'pts/v2/payments', cuerpo: {}, fetchImpl: f })).toMatchObject({ ok: false, clase: 'antes_de_enviar' })
    expect(llamadas).toHaveLength(0)
  })
  it('ninguna fuga: ni el secreto ni la firma aparecen en descripciones, mensajes ni textos depurados', async () => {
    const cfg = cfgOk()
    const f = await firmarCS(cfg, 'POST', RUTAS_CS.pagos, cuerpoBytesCS({}), FECHA)
    const sig = /signature="([^"]+)"/.exec(f.headers.Signature)![1]
    expect(depurarCS(`Signature: ${f.headers.Signature} secreto ${SECRET} tarjeta 4111111111111111 doc@x.mx`)).toBe('Signature: keyid="‹token›", algorithm="HmacSHA256", headers="host date request-target digest v-c-merchant-id", signature="‹oculto›" secreto ‹token› tarjeta ‹número› ‹correo›')
    expect(depurarCS(`x ${sig} y`)).not.toContain(sig)
    expect(mensajeErrorCS(401, { status: 'UNAUTHORIZED', message: `bad key ${SECRET}` })).not.toContain(SECRET)
    const { f: ft } = transporte(() => { throw new TypeError(`fetch failed ${SECRET}`) })
    const r = await solicitarCS(cfg, { metodo: 'POST', ruta: RUTAS_CS.pagos, cuerpo: {}, fetchImpl: ft })
    expect(JSON.stringify(r)).not.toContain(SECRET)
  })
})

describe('CS-1A.2 · guardas de fuente', () => {
  const sinComentarios = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n')
  it('sin Deno.env, sin console, sin bucles de reintento, sin desactivar la firma, producción apagada', () => {
    expect(sinComentarios).not.toMatch(/Deno\.env|console\.(log|warn|error)/)
    expect(sinComentarios).not.toMatch(/reintent|retry|for \(let i = 0; i < (2|3)/i)
    expect(sinComentarios).not.toMatch(/sinFirma|skipSignature|verificarFirma\s*=\s*false|insecure/i)
    expect(sinComentarios).toMatch(/PRODUCCION_CS_HABILITADA = false/)
    expect(sinComentarios).toMatch(/HOSTS_CS: Record<AmbienteCS, string> = \{ test: 'apitest\.cybersource\.com', production: 'api\.cybersource\.com' \}/)
  })
})

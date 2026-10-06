// CC-0B · Limitador: sujeto correcto (uid o IP hasheada, nunca cruda), reglas centralizadas
// con override seguro, veredicto desde la base, fallo del limitador = cerrado (503) sin
// filtrar detalles, 429 controlado, seam de CAPTCHA dormido sin secreto.
import { describe, it, expect } from 'vitest'
import {
  LIMITES, FACTOR_DESAFIO, regla, ipDe, normalizarIp, CABECERA_IP_CONFIABLE, sujetoPublico, sujetoUid, limitar, limitarTodas, respuestaLimite, desafioResuelto, tokensEstimados,
  type ClienteRpc, type Veredicto,
} from '../../../../../supabase/functions/_shared/limite'

const env = (vars: Record<string, string | undefined>) => (k: string) => vars[k]
const sinEnv = env({})
const req = (headers: Record<string, string> = {}) => new Request('https://x.supabase.co/functions/v1/f', { method: 'POST', headers })

interface Llamada { fn: string; args: Record<string, unknown> }
function fakeRpc(respuesta: (l: Llamada) => { data: unknown; error: { message?: string } | null }): ClienteRpc & { llamadas: Llamada[] } {
  const llamadas: Llamada[] = []
  return { llamadas, rpc: async (fn, args) => { const l = { fn, args }; llamadas.push(l); return respuesta(l) } }
}
const okRpc = (allowed: boolean, count = 1, extra: Record<string, unknown> = {}) =>
  fakeRpc(() => ({ data: { allowed, count, remaining: allowed ? 1 : 0, retry_after_secs: 42, reset_at: '2026-10-05T12:00:00Z', ...extra }, error: null }))

describe('reglas centralizadas', () => {
  it('todos los scopes que usan las edges existen y son conservadores', () => {
    for (const s of ['assistant_landing_burst', 'assistant_landing_hora', 'assistant_landing_global', 'assistant_tokens_dia', 'assistant_tokens_dia_uid', 'assistant_doctor_burst', 'capture_lead', 'capture_lead_global', 'register_doctor', 'register_doctor_global']) {
      expect(LIMITES[s], s).toBeDefined()
      expect(LIMITES[s].limite).toBeGreaterThan(0)
      expect(LIMITES[s].ventanaSegs).toBeLessThanOrEqual(86400)
    }
    expect(LIMITES.register_doctor.limite).toBeLessThanOrEqual(5)
    expect(LIMITES.capture_lead.limite).toBeLessThanOrEqual(10)
  })
  it('RATE_LIMITS_JSON sobreescribe solo con valores válidos; basura → default; scope desconocido → lanza', () => {
    expect(regla('capture_lead', env({ RATE_LIMITS_JSON: '{"capture_lead":{"limite":20,"ventanaSegs":600}}' }))).toEqual({ limite: 20, ventanaSegs: 600 })
    expect(regla('capture_lead', env({ RATE_LIMITS_JSON: '{"capture_lead":{"limite":0,"ventanaSegs":600}}' }))).toEqual(LIMITES.capture_lead)
    expect(regla('capture_lead', env({ RATE_LIMITS_JSON: '{"capture_lead":{"limite":5,"ventanaSegs":9999999}}' }))).toEqual(LIMITES.capture_lead)
    expect(regla('capture_lead', env({ RATE_LIMITS_JSON: 'no json' }))).toEqual(LIMITES.capture_lead)
    expect(() => regla('no_existe', sinEnv)).toThrow()
  })
})

describe('sujeto', () => {
  it('E · authenticated: uid', () => { expect(sujetoUid('abc')).toBe('uid:abc') })
  it('la autoridad de IP es cf-connecting-ip (la fija el gateway; el cliente no puede suministrarla)', () => {
    expect(CABECERA_IP_CONFIABLE).toBe('cf-connecting-ip')
    expect(ipDe(req({ 'cf-connecting-ip': '198.51.100.7' }))).toBe('198.51.100.7')
    expect(ipDe(req({ 'cf-connecting-ip': ' 198.51.100.7 ' }))).toBe('198.51.100.7')
  })
  it('A · misma cf-connecting-ip repetida → mismo sujeto; B · distinta → distinto', async () => {
    const a1 = await sujetoPublico(req({ 'cf-connecting-ip': '203.0.113.9' }), sinEnv)
    const a2 = await sujetoPublico(req({ 'cf-connecting-ip': '203.0.113.9' }), sinEnv)
    const b = await sujetoPublico(req({ 'cf-connecting-ip': '203.0.113.10' }), sinEnv)
    expect(a1).toMatch(/^ip:[0-9a-f]{32}$/); expect(a1).toBe(a2); expect(b).not.toBe(a1)
  })
  it('C/D · x-forwarded-for con último salto cambiante o falsificada NO altera el sujeto cuando hay primaria', async () => {
    const base = await sujetoPublico(req({ 'cf-connecting-ip': '203.0.113.9' }), sinEnv)
    for (const xff of ['203.0.113.9, 203.0.113.9, 172.16.0.1', '203.0.113.9, 203.0.113.9, 172.16.0.2', '9.9.9.9', 'evil, also evil, 8.8.8.8']) {
      expect(await sujetoPublico(req({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': xff }), sinEnv)).toBe(base)
    }
    // x-real-ip / true-client-ip pasan tal cual los escribe el cliente: se ignoran
    expect(await sujetoPublico(req({ 'cf-connecting-ip': '203.0.113.9', 'x-real-ip': '8.8.8.8', 'true-client-ip': '8.8.8.8' }), sinEnv)).toBe(base)
  })
  it('E/F · sin primaria o malformada → cubo compartido determinista, nunca un sujeto nuevo ni límite apagado', async () => {
    expect(ipDe(req())).toBeNull()
    expect(await sujetoPublico(req(), sinEnv)).toBe('ip:desconocida')
    // sin cf-connecting-ip, x-forwarded-for / x-real-ip NO sirven de fallback (no son confiables)
    expect(await sujetoPublico(req({ 'x-forwarded-for': '203.0.113.9' }), sinEnv)).toBe('ip:desconocida')
    expect(await sujetoPublico(req({ 'x-real-ip': '203.0.113.9' }), sinEnv)).toBe('ip:desconocida')
    for (const mala of ['not an ip at all!!', '999.1.1.1', '1.2.3', '1.2.3.4.5', 'fe80::1%eth0', '[::1]', '', '   ']) {
      expect(await sujetoPublico(req({ 'cf-connecting-ip': mala }), sinEnv)).toBe('ip:desconocida')
    }
  })
  it('G/H · IPv4 e IPv6 válidas se normalizan (minúsculas, sin espacios)', () => {
    expect(normalizarIp('203.0.113.9')).toBe('203.0.113.9')
    expect(normalizarIp('0.0.0.0')).toBe('0.0.0.0')
    expect(normalizarIp('2001:DB8::1')).toBe('2001:db8::1')
    expect(normalizarIp('::1')).toBe('::1')
    expect(normalizarIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334')
    expect(normalizarIp('::ffff:203.0.113.9')).toBe('::ffff:203.0.113.9')
    expect(normalizarIp('1:2:3:4:5:6:7:8:9')).toBeNull()
    expect(normalizarIp('1::2::3')).toBeNull()
    expect(normalizarIp('12345::1')).toBeNull()
    expect(normalizarIp('::ffff:999.0.113.9')).toBeNull()
  })
  it('I/J · primaria con comas o muy larga → inválida (no se toma "la primera")', async () => {
    expect(normalizarIp('1.2.3.4, 5.6.7.8')).toBeNull()
    expect(normalizarIp('1.2.3.4,5.6.7.8')).toBeNull()
    expect(normalizarIp('a'.repeat(300))).toBeNull()
    expect(normalizarIp('2001:db8::' + '1'.repeat(40))).toBeNull()
    expect(await sujetoPublico(req({ 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' }), sinEnv)).toBe('ip:desconocida')
    expect(await sujetoPublico(req({ 'cf-connecting-ip': 'x'.repeat(300) }), sinEnv)).toBe('ip:desconocida')
  })
  it('el sujeto público es un hash (nunca la IP cruda); con sal cambia y sigue sin ser la IP', async () => {
    const s = await sujetoPublico(req({ 'cf-connecting-ip': '203.0.113.9' }), sinEnv)
    expect(s).not.toContain('203.0.113.9')
    const conSal = await sujetoPublico(req({ 'cf-connecting-ip': '203.0.113.9' }), env({ RATE_LIMIT_SALT: 'secreto' }))
    expect(conSal).toMatch(/^ip:[0-9a-f]{32}$/); expect(conSal).not.toBe(s); expect(conSal).not.toContain('203.0.113.9')
  })
})

describe('limitar', () => {
  it('llama a rate_limit_hit con la regla del scope y el sujeto; permitido → ok', async () => {
    const c = okRpc(true, 3)
    const v = await limitar(c, 'capture_lead', 'ip:x', { env: sinEnv })
    expect(c.llamadas[0]).toEqual({ fn: 'rate_limit_hit', args: { p_scope: 'capture_lead', p_subject: 'ip:x', p_limit: 5, p_window_secs: 600, p_cost: 1 } })
    expect(v).toMatchObject({ permitido: true, estado: 'ok', scope: 'capture_lead', reintentarEn: 42, reiniciaEn: '2026-10-05T12:00:00Z', desafio: false })
  })
  it('A/B · no permitido → limitado, con retry; por encima de 2× el límite → desafio', async () => {
    const v = await limitar(okRpc(false, 6), 'capture_lead', 'ip:x', { env: sinEnv })
    expect(v).toMatchObject({ permitido: false, estado: 'limitado', desafio: false })
    const v2 = await limitar(okRpc(false, 5 * FACTOR_DESAFIO + 1), 'capture_lead', 'ip:x', { env: sinEnv })
    expect(v2.desafio).toBe(true)
  })
  it('S · error del limitador: cerrado, sin SQL ni detalles, reportado como internal_error', async () => {
    const reportes: unknown[] = []
    const reportar = (a: string, c: string, d?: unknown) => reportes.push([a, c, d])
    const v1 = await limitar(fakeRpc(() => ({ data: null, error: { message: 'relation "rate_limit_buckets" does not exist' } })), 'capture_lead', 'ip:x', { env: sinEnv, reportar })
    expect(v1).toEqual({ permitido: false, estado: 'sin_limiter', scope: 'capture_lead' })
    const v2 = await limitar({ rpc: async () => { throw new Error('ECONNRESET') } }, 'capture_lead', 'ip:x', { env: sinEnv, reportar })
    expect(v2.estado).toBe('sin_limiter')
    const v3 = await limitar(fakeRpc(() => ({ data: { basura: true }, error: null })), 'capture_lead', 'ip:x', { env: sinEnv, reportar })
    expect(v3.estado).toBe('sin_limiter')
    const v4 = await limitar(okRpc(true), 'scope_inexistente', 'ip:x', { env: sinEnv, reportar })
    expect(v4.estado).toBe('sin_limiter')
    expect(reportes.map((r) => (r as unknown[])[1])).toEqual(['internal_error', 'internal_error', 'internal_error', 'internal_error'])
    expect(JSON.stringify(v1) + JSON.stringify(v2)).not.toMatch(/relation|ECONNRESET/)
  })
  it('limitarTodas: la primera que niega manda y no sigue consultando; costo por regla', async () => {
    const c = fakeRpc((l) => ({ data: { allowed: l.args.p_scope !== 'assistant_landing_global', count: 1 }, error: null }))
    const v = await limitarTodas(c, [
      { scope: 'assistant_landing_burst', sujeto: 'ip:x' }, { scope: 'assistant_landing_global', sujeto: 'global' }, { scope: 'assistant_landing_hora', sujeto: 'ip:x' },
    ], { env: sinEnv })
    expect(v.permitido).toBe(false); expect(v.scope).toBe('assistant_landing_global')
    expect(c.llamadas.map((l) => l.fn)).toEqual(['rate_limit_hit', 'rate_limit_hit'])
    const t = fakeRpc(() => ({ data: { allowed: true, count: 10 }, error: null }))
    await limitarTodas(t, [{ scope: 'assistant_tokens_dia', sujeto: 'global', costo: 1234 }], { env: sinEnv })
    expect(t.llamadas[0].args.p_cost).toBe(1234)
  })
})

describe('respuestaLimite', () => {
  it('429 controlado con Retry-After y sin detalles; 503 cuando el limitador no está', async () => {
    const r = respuestaLimite({ permitido: false, estado: 'limitado', scope: 's', reintentarEn: 17, desafio: true })
    expect(r.status).toBe(429); expect(r.headers.get('Retry-After')).toBe('17')
    expect(await r.json()).toEqual({ error: 'rate_limited', message: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.', retry_after_secs: 17, challenge: 'captcha' })
    const s = respuestaLimite({ permitido: false, estado: 'sin_limiter', scope: 's' } as Veredicto)
    expect(s.status).toBe(503); expect(s.headers.get('Retry-After')).toBe('30')
    expect(JSON.stringify(await s.json())).not.toMatch(/sql|relation|rpc/i)
  })
})

describe('seam Turnstile y estimación de tokens', () => {
  it('sin TURNSTILE_SECRET: no_configurado (no bloquea ni abre); con secreto: verifica y falla cerrado', async () => {
    expect(await desafioResuelto(req(), sinEnv)).toBe('no_configurado')
    const e = env({ TURNSTILE_SECRET: 's' })
    expect(await desafioResuelto(req(), e)).toBe('fallido')
    const okFetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 })
    const badFetch = async () => new Response(JSON.stringify({ success: false }), { status: 200 })
    const downFetch = async () => { throw new Error('down') }
    expect(await desafioResuelto(req({ 'cf-turnstile-response': 'tok' }), e, okFetch)).toBe('ok')
    expect(await desafioResuelto(req({ 'cf-turnstile-response': 'tok' }), e, badFetch)).toBe('fallido')
    expect(await desafioResuelto(req({ 'cf-turnstile-response': 'tok' }), e, downFetch)).toBe('fallido')
  })
  it('tokensEstimados: chars/4 + salida máxima', () => {
    expect(tokensEstimados(['a'.repeat(400), 'b'.repeat(100)], 500)).toBe(625)
    expect(tokensEstimados([], 900)).toBe(900)
  })
})

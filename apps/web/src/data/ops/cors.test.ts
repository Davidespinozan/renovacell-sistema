// CC-0B · CORS por lista blanca: orígenes conocidos reciben cabeceras, desconocidos no,
// sin Origin (servidor a servidor / webhooks) nada cambia; OPTIONS correcto; nunca se
// refleja un Origin arbitrario.
import { describe, it, expect } from 'vitest'
import { ORIGENES_BASE, origenPermitido, cabecerasCors, conCors } from '../../../../../supabase/functions/_shared/cors'

const env = (vars: Record<string, string | undefined>) => (k: string) => vars[k]
const sinEnv = env({})
const req = (origin?: string, method = 'POST') => new Request('https://x.supabase.co/functions/v1/f', { method, headers: origin ? { origin } : {} })
const handler = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('origenPermitido', () => {
  it('I · los orígenes reales del sistema y la landing están permitidos', () => {
    for (const o of ['https://sistema-renovacell.netlify.app', 'https://sistema.renovacell.mx', 'https://renovacell.mx', 'https://www.renovacell.mx', 'http://localhost:5173']) {
      expect(origenPermitido(o, sinEnv), o).toBe(true)
    }
    expect(ORIGENES_BASE.length).toBe(7)
  })
  it('previsualizaciones de Netlify del MISMO sitio: sí; de otro sitio: no', () => {
    expect(origenPermitido('https://deploy-preview-12--sistema-renovacell.netlify.app', sinEnv)).toBe(true)
    expect(origenPermitido('https://deploy-preview-12--otro-sitio.netlify.app', sinEnv)).toBe(false)
    expect(origenPermitido('https://sistema-renovacell.netlify.app.evil.com', sinEnv)).toBe(false)
  })
  it('J · arbitrarios, null, vacío, http en producción: no', () => {
    for (const o of ['https://evil.com', 'null', '', 'http://sistema.renovacell.mx', 'https://renovacell.mx.attacker.io', 'https://sistema-renovacell.netlify.app/', undefined, null]) {
      expect(origenPermitido(o as string, sinEnv), String(o)).toBe(false)
    }
  })
  it('CORS_ORIGINS suma orígenes válidos; ignora basura', () => {
    const e = env({ CORS_ORIGINS: 'https://nuevo.renovacell.mx, no-es-url, https://otro.mx/path' })
    expect(origenPermitido('https://nuevo.renovacell.mx', e)).toBe(true)
    expect(origenPermitido('no-es-url', e)).toBe(false)
    expect(origenPermitido('https://otro.mx/path', e)).toBe(false)
  })
})

describe('cabecerasCors / conCors', () => {
  it('I · origen permitido: ACAO = ese origen, Vary: Origin, métodos y cabeceras', async () => {
    const h = cabecerasCors(req('https://sistema.renovacell.mx'), sinEnv)!
    expect(h['Access-Control-Allow-Origin']).toBe('https://sistema.renovacell.mx')
    expect(h['Vary']).toBe('Origin')
    expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
    expect(h['Access-Control-Allow-Headers']).toContain('authorization')
    const res = await conCors(handler, sinEnv)(req('https://sistema.renovacell.mx'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://sistema.renovacell.mx')
    expect(await res.json()).toEqual({ ok: true })
  })
  it('J · origen desconocido: la respuesta sale SIN cabeceras CORS (nunca se refleja)', async () => {
    expect(cabecerasCors(req('https://evil.com'), sinEnv)).toBeNull()
    const res = await conCors(handler, sinEnv)(req('https://evil.com'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
  })
  it('L/M · sin Origin (webhooks, curl): el handler corre igual y no hay cabeceras CORS', async () => {
    const res = await conCors(handler, sinEnv)(req(undefined))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
  it('K · OPTIONS: 204 con cabeceras para permitido; 403 para desconocido; 204 sin cabeceras sin Origin', async () => {
    const ok = await conCors(handler, sinEnv)(req('https://renovacell.mx', 'OPTIONS'))
    expect(ok.status).toBe(204)
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://renovacell.mx')
    expect(ok.headers.get('Access-Control-Max-Age')).toBe('600')
    const no = await conCors(handler, sinEnv)(req('https://evil.com', 'OPTIONS'))
    expect(no.status).toBe(403)
    expect(no.headers.get('Access-Control-Allow-Origin')).toBeNull()
    const sin = await conCors(handler, sinEnv)(req(undefined, 'OPTIONS'))
    expect(sin.status).toBe(204)
    expect(sin.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
  it('conserva estado, cuerpo y cabeceras del handler (p. ej. 429 + Retry-After)', async () => {
    const h429 = async () => new Response('{"error":"rate_limited"}', { status: 429, headers: { 'Retry-After': '30', 'Content-Type': 'application/json' } })
    const res = await conCors(h429, sinEnv)(req('https://renovacell.mx'))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://renovacell.mx')
  })
})

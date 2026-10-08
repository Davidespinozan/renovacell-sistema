// CC-0B · CORS por lista blanca: orígenes conocidos reciben cabeceras, desconocidos no,
// sin Origin (servidor a servidor / webhooks) nada cambia; OPTIONS correcto; nunca se
// refleja un Origin arbitrario.
import { describe, it, expect } from 'vitest'
// @ts-expect-error tipos de node no incluidos en el tsconfig del front (vitest corre en Node)
import { readFileSync } from 'node:fs'
import { ORIGENES_BASE, ORIGENES_APP, origenPermitido, cabecerasCors, conCors } from '../../../../../supabase/functions/_shared/cors'

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

// CX-0B · portal.renovacell.mx = otra puerta de la MISMA SPA: permitido en las funciones de la app (alcance
// 'app', el predeterminado) y NO en las de la landing (assistant, capture-lead). Sin comodines ni reflejo.
describe('CX-0B · portal.renovacell.mx por alcance', () => {
  const PORTAL = 'https://portal.renovacell.mx'
  it('la lista del portal es exactamente esa puerta; la base no cambió; nunca "*"', () => {
    expect([...ORIGENES_APP]).toEqual([PORTAL])
    expect(ORIGENES_BASE).not.toContain(PORTAL)
    expect([...ORIGENES_BASE, ...ORIGENES_APP].some((o) => o.includes('*'))).toBe(false)
  })
  it('alcance app (predeterminado): portal permitido con ACAO = portal y Vary: Origin', async () => {
    expect(origenPermitido(PORTAL, sinEnv)).toBe(true)
    expect(origenPermitido(PORTAL, sinEnv, 'app')).toBe(true)
    const res = await conCors(handler, sinEnv)(req(PORTAL))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PORTAL)
    expect(res.headers.get('Vary')).toBe('Origin')
  })
  it('preflight del portal en la app: 204, métodos y cabeceras (authorization, apikey, content-type)', async () => {
    const pre = await conCors(handler, sinEnv)(req(PORTAL, 'OPTIONS'))
    expect(pre.status).toBe(204)
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(PORTAL)
    expect(pre.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    for (const h of ['authorization', 'apikey', 'content-type', 'x-client-info']) expect(pre.headers.get('Access-Control-Allow-Headers')).toContain(h)
    expect(pre.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })
  it('alcance landing: el portal NO recibe cabeceras y su preflight es 403; la landing sigue permitida', async () => {
    expect(origenPermitido(PORTAL, sinEnv, 'landing')).toBe(false)
    expect(cabecerasCors(req(PORTAL), sinEnv, 'landing')).toBeNull()
    const pre = await conCors(handler, sinEnv, 'landing')(req(PORTAL, 'OPTIONS'))
    expect(pre.status).toBe(403)
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull()
    for (const o of ['https://renovacell.mx', 'https://www.renovacell.mx', 'https://sistema.renovacell.mx']) {
      expect(origenPermitido(o, sinEnv, 'landing'), o).toBe(true)
    }
  })
  it('imitaciones del portal: rechazadas en ambos alcances (sin reflejo)', async () => {
    for (const o of ['https://portal.renovacell.mx.evil.com', 'http://portal.renovacell.mx', 'https://portal.renovacell.mx/', 'https://xportal.renovacell.mx',
      'https://portal.renovacell.mx:8443', 'https://evil.com/portal.renovacell.mx', 'https://staging.portal.renovacell.mx']) {
      expect(origenPermitido(o, sinEnv, 'app'), o).toBe(false)
      expect(origenPermitido(o, sinEnv, 'landing'), o).toBe(false)
      const pre = await conCors(handler, sinEnv)(req(o, 'OPTIONS'))
      expect(pre.status, o).toBe(403)
    }
  })
  it('sin Origin (servidor a servidor) nada cambia en ningún alcance', async () => {
    for (const a of ['app', 'landing'] as const) {
      const res = await conCors(handler, sinEnv, a)(req(undefined))
      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    }
  })
  it('las funciones reales declaran su alcance: solo assistant y capture-lead son landing; las 17 de la SPA usan el predeterminado', () => {
    const base = new URL('../../../../../supabase/functions/', import.meta.url)
    const LANDING = ['assistant', 'capture-lead']
    const APP = ['cart', 'cfdi', 'cfdi-cancel', 'cfdi-cancel-status', 'cfdi-download', 'cfdi-send', 'chat', 'comm-dispatch', 'invite-doctor',
      'meta-send', 'register-doctor', 'report-transfer', 'shipping', 'staff-admin', 'stripe-checkout', 'verify-cedula', 'visitor']
    for (const f of [...LANDING, ...APP]) {
      const src = readFileSync(new URL(`${f}/index.ts`, base), 'utf8')
      expect((src.match(/conCors\(/g) ?? []).length, f).toBe(1)
      expect(/\}, undefined, 'landing'\)\)/.test(src), f).toBe(LANDING.includes(f))
    }
  })
})

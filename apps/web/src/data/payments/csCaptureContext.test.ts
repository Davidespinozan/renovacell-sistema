// CS-1A.3 · Capture Context: contrato puro (request oficial v2, lectura del JWT, respuesta mínima al navegador, traducción de
// errores) + guardas de fuente de la Edge `cs-capture-context` (autenticación, verificación, origen, seam 501, sin cobros ni 3DS).
import { describe, it, expect } from 'vitest'
import edge from '../../../../../supabase/functions/cs-capture-context/index.ts?raw'
import {
  REDES_TARJETA_CS, buildCaptureContextRequest, leerCaptureContext, respuestaParaNavegador, traducirErrorAbrir, ESTADOS_REEMISION_CS,
} from '../../../../../supabase/functions/cs-capture-context/contrato'
import { solicitarCS, csConfig, RUTAS_CS, type ConfigCS } from '../../../../../supabase/functions/_shared/cybersource'

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (payload: unknown) => `${b64url({ alg: 'RS256', kid: 'kid-1' })}.${b64url(payload)}.firma`
const AHORA = new Date('2026-10-20T15:00:00Z')
const ORIGEN = 'https://portal.renovacell.mx'
const ctxOk = (extra: Record<string, unknown> = {}) => jwt({
  exp: Math.floor(AHORA.getTime() / 1000) + 900, iat: Math.floor(AHORA.getTime() / 1000), iss: 'Flex API',
  ctx: [{ data: { clientLibrary: 'https://flex.cybersource.com/microform/bundle/v2/flex-microform.min.js', clientLibraryIntegrity: 'sha256-abcDEF', targetOrigins: [ORIGEN], allowedCardNetworks: ['VISA'] }, type: 'mf-2.0.0' }],
  ...extra,
})

describe('CS-1A.3 · request oficial del capture context v2', () => {
  it('solo clientVersion v2, el origen de la página, las redes permitidas y CARD; nada más', () => {
    expect(buildCaptureContextRequest(ORIGEN)).toEqual({ clientVersion: 'v2', targetOrigins: [ORIGEN], allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX', 'CARNET'], allowedPaymentTypes: ['CARD'] })
    expect(REDES_TARJETA_CS).toEqual(['VISA', 'MASTERCARD', 'AMEX', 'CARNET'])
    expect(buildCaptureContextRequest('http://localhost:5173').targetOrigins).toEqual(['http://localhost:5173'])
    for (const malo of ['', 'null', 'portal.renovacell.mx', 'https://portal.renovacell.mx/pagos', 'http://evil.test', 'https://a b']) expect(() => buildCaptureContextRequest(malo)).toThrow('origen inválido')
  })
})

describe('CS-1A.3 · lectura del capture context', () => {
  it('válido: expiración, librería e integridad desde el JWT; origen coincide', () => {
    const r = leerCaptureContext(ctxOk(), ORIGEN, AHORA)
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.info).toEqual({ exp: new Date(AHORA.getTime() + 900_000), clientLibrary: 'https://flex.cybersource.com/microform/bundle/v2/flex-microform.min.js', clientLibraryIntegrity: 'sha256-abcDEF', targetOrigins: [ORIGEN] })
  })
  it('rechaza: no JWT, payload inválido, sin librería, librería ajena a cybersource.com, sin exp, expirado, origen distinto', () => {
    expect(leerCaptureContext('no-es-un-jwt', ORIGEN, AHORA)).toEqual({ ok: false, motivo: 'no_jwt' })
    expect(leerCaptureContext('a.!!!.c', ORIGEN, AHORA)).toEqual({ ok: false, motivo: 'payload_invalido' })
    expect(leerCaptureContext(jwt({ exp: 1, ctx: [] }), ORIGEN, AHORA)).toEqual({ ok: false, motivo: 'sin_libreria' })
    expect(leerCaptureContext(ctxOk({ ctx: [{ data: { clientLibrary: 'https://evil.example/flex.js', clientLibraryIntegrity: 'sha256-x' } }] }), ORIGEN, AHORA)).toEqual({ ok: false, motivo: 'libreria_no_cybersource' })
    expect(leerCaptureContext(ctxOk({ ctx: [{ data: { clientLibrary: 'http://flex.cybersource.com/x.js', clientLibraryIntegrity: 'sha256-x' } }] }), ORIGEN, AHORA)).toEqual({ ok: false, motivo: 'libreria_no_cybersource' })
    expect(leerCaptureContext(ctxOk({ ctx: [{ data: { clientLibrary: 'https://notcybersource.com/x.js', clientLibraryIntegrity: 'sha256-x' } }] }), ORIGEN, AHORA)).toEqual({ ok: false, motivo: 'libreria_no_cybersource' })
    expect(leerCaptureContext(ctxOk({ exp: undefined }), ORIGEN, AHORA)).toEqual({ ok: false, motivo: 'sin_expiracion' })
    expect(leerCaptureContext(ctxOk({ exp: Math.floor(AHORA.getTime() / 1000) - 1 }), ORIGEN, AHORA)).toEqual({ ok: false, motivo: 'expirado' })
    expect(leerCaptureContext(ctxOk(), 'https://otro.renovacell.mx', AHORA)).toEqual({ ok: false, motivo: 'origen_distinto' })
  })
  it('respuesta al navegador: solo lo necesario para Microform; sin merchant, key, secreto ni cabeceras', () => {
    const r = leerCaptureContext(ctxOk(), ORIGEN, AHORA); if (!r.ok) throw new Error('ctx')
    const out = respuestaParaNavegador({ attempt_id: '11111111-1111-4111-8111-111111111111', amount: 6000, ambiente: 'test', reutilizado: false }, ctxOk(), r.info)
    expect(Object.keys(out).sort()).toEqual(['ambiente', 'amount', 'attempt_id', 'capture_context', 'client_library', 'client_library_integrity', 'currency', 'expires_at', 'reutilizado'])
    expect(out.amount).toBe(6000); expect(out.currency).toBe('MXN'); expect(out.expires_at).toBe('2026-10-20T15:15:00.000Z')
    expect(JSON.stringify(out)).not.toMatch(/merchant|keyId|secret|Signature|v-c-/i)
  })
  it('errores de cs_intento_abrir se traducen a códigos y mensajes de operador', () => {
    expect(traducirErrorAbrir('NO_AUTORIZADO: solo el doctor dueño…')).toMatchObject({ status: 403, error: 'no_autorizado' })
    expect(traducirErrorAbrir('SIN_SALDO: el pedido no tiene saldo pendiente')).toMatchObject({ status: 409, error: 'sin_saldo' })
    expect(traducirErrorAbrir('PEDIDO_NO_PAGABLE: cancelled')).toMatchObject({ status: 409, error: 'pedido_no_pagable' })
    expect(traducirErrorAbrir('PEDIDO_INEXISTENTE')).toMatchObject({ status: 404 })
    expect(traducirErrorAbrir('algo raro con detalles internos')).toEqual({ status: 500, error: 'intento', message: 'No se pudo preparar el pago con tarjeta. Intenta de nuevo.' })
    expect(ESTADOS_REEMISION_CS).toEqual(['created', 'tokenized', 'auth_setup', 'auth_pending', 'auth_challenge', 'auth_validated'])
  })
})

describe('CS-1A.3 · el cliente devuelve el JWT en texto sin alterarlo', () => {
  const SECRET = btoa('renovacell-cs1a3-vector-de-prueba-0123456789')
  const cfg = (): ConfigCS => { const c = csConfig((k) => ({ CS_API_ENV: 'test', CS_MERCHANT_ID: 'renovacell_mx', CS_KEY_ID: 'kid-0000-0000', CS_SHARED_SECRET: SECRET })[k]); if (!c.ok) throw new Error(c.detalle); return c.cfg }
  it("aceptar: 'texto' entrega el cuerpo íntegro (un JWT largo no se depura) y sigue sin reintentos", async () => {
    const token = ctxOk()
    const llamadas: string[] = []
    const f = (async (u: string | URL | Request) => { llamadas.push(String(u)); return new Response(token + '\n', { status: 201, headers: { 'content-type': 'application/jwt' } }) }) as unknown as typeof fetch
    const r = await solicitarCS<string>(cfg(), { metodo: 'POST', ruta: RUTAS_CS.captureContext, cuerpo: buildCaptureContextRequest(ORIGEN), aceptar: 'texto', fetchImpl: f })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.data).toBe(token); expect(llamadas).toEqual(['https://apitest.cybersource.com/microform/v2/sessions'])
    const r4 = await solicitarCS<string>(cfg(), { metodo: 'POST', ruta: RUTAS_CS.captureContext, cuerpo: {}, aceptar: 'texto', fetchImpl: (async () => new Response(JSON.stringify({ status: 'INVALID_REQUEST', message: 'targetOrigins required' }), { status: 400 })) as unknown as typeof fetch })
    expect(r4).toMatchObject({ ok: false, clase: 'http', status: 400, mensaje: 'CyberSource 400: INVALID_REQUEST · targetOrigins required' })
  })
})

describe('CS-1A.3 · guardas de fuente de la Edge cs-capture-context', () => {
  const src = edge.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  it('autentica, exige doctor verificado o Dirección, valida el origen con la lista blanca de CORS y abre el intento con el JWT del llamante', () => {
    expect(src).toMatch(/resolverQuien\(caller, admin\)/)
    expect(src).toMatch(/q\.quien\.role === 'doctor' && q\.quien\.verified/)
    expect(src).toMatch(/origenPermitido\(origen, Deno\.env\.get, 'app'\)/)
    expect(src).toMatch(/caller\.rpc\('cs_intento_abrir', \{ p_order: orderId, p_ambiente: cfg\.ambiente \}\)/)
    expect(src).toMatch(/csConfig\(Deno\.env\.get\)/); expect(src).toMatch(/json\(501, \{ error: 'not_configured'/)
    expect(src).toMatch(/RUTAS_CS\.captureContext/); expect(src).toMatch(/aceptar: 'texto'/)
  })
  it('no cobra, no autoriza, no hace 3DS, no toca el ledger ni expone secretos; el navegador no elige nada', () => {
    expect(src).not.toMatch(/RUTAS_CS\.(pagos|payerSetup|payerEnroll|payerValidate|reversals)|pts\/v2|risk\/v1|registrar_cobro|cs_intento_contabilizar|payOrder/)
    expect(src).not.toMatch(/sharedSecret|keyId|firma\.headers|Signature|console\.(log|warn|error)/)
    expect(src).not.toMatch(/payload\.(ambiente|amount|merchant|host|origin|targetOrigins)/)
    expect(src).not.toMatch(/cs_intento_avanzar/)   // en CS-1A.3 el intento se queda en created; la transición llega con el token (CS-1A.4)
    expect(src).toMatch(/respuestaParaNavegador\(/)
    expect(src).toMatch(/if \(a\.bloqueado\) return json\(409/)
    expect(src).toMatch(/ESTADOS_REEMISION_CS\.includes/)
  })
})

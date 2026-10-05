// W4-05/06 · Comunicación transaccional — adaptador, plantillas y despachador.
//
// Lo que se protege: que sin proveedor configurado no se envíe NI se finja nada; que
// "enviado" exija la confirmación del proveedor; que un corte no sea ni éxito ni
// rechazo; y que el mismo hecho del negocio viaje siempre con la misma llave para que
// un reintento no le mande dos correos al cliente.
import { describe, it, expect, vi } from 'vitest'
import {
  leerConfig, clasificar, enviarCorreo, sanitiza, TIMEOUT_CORREO_MS, type ConfigCorreo, type Mensaje,
} from '../../../../../supabase/functions/_shared/correo'
import { renderizar, PLANTILLAS, esPlantilla } from '../../../../../supabase/functions/_shared/plantillas'
import dispatchSrc from '../../../../../supabase/functions/comm-dispatch/index.ts?raw'
import correoSrc from '../../../../../supabase/functions/_shared/correo.ts?raw'
import migSrc from '../../../../../supabase/migrations/20261021120000_w4_comunicaciones.sql?raw'

const soloCodigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')
const CFG: ConfigCorreo = { proveedor: 'resend', apiKey: 're_SECRETO_123', remitente: 'Renovacell <pedidos@renovacell.mx>' }
const MSG: Mensaje = { para: 'dra@clinica.mx', asunto: 'A', texto: 't', html: '<p>t</p>', llaveIdempotencia: 'pago_recibido:abc:1' }
const env = (o: Record<string, string>) => (k: string) => o[k]
const resp = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('falla cerrado: sin proveedor configurado no hay envío', () => {
  it('sin nada configurado → null', () => { expect(leerConfig(env({}))).toBeNull() })
  it('configurado a medias → null (no se improvisa un remitente ni una llave)', () => {
    expect(leerConfig(env({ MAIL_PROVIDER: 'resend' }))).toBeNull()
    expect(leerConfig(env({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k' }))).toBeNull()
    expect(leerConfig(env({ MAIL_PROVIDER: 'resend', MAIL_FROM: 'a@b.mx' }))).toBeNull()
    expect(leerConfig(env({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k', MAIL_FROM: 'sin-arroba' }))).toBeNull()
  })
  it('proveedor desconocido → null (no hay proveedor "por omisión")', () => {
    expect(leerConfig(env({ MAIL_PROVIDER: 'mailgun', MAIL_API_KEY: 'k', MAIL_FROM: 'a@b.mx' }))).toBeNull()
  })
  it('completo → configuración', () => {
    expect(leerConfig(env({ MAIL_PROVIDER: ' Resend ', MAIL_API_KEY: ' k ', MAIL_FROM: 'a@b.mx' })))
      .toEqual({ proveedor: 'resend', apiKey: 'k', remitente: 'a@b.mx' })
  })
  it('el despachador revisa la configuración ANTES de reclamar un solo mensaje', () => {
    const c = soloCodigo(dispatchSrc)
    expect(c.indexOf('leerConfig(')).toBeGreaterThan(-1)
    expect(c.indexOf('leerConfig(')).toBeLessThan(c.indexOf("rpc('comm_reclamar'"))
    expect(c).toMatch(/if \(!cfg\) \{\s*return json\(501/)
  })
  it('no existe un modo simulado que reporte envíos', () => {
    expect(soloCodigo(correoSrc) + soloCodigo(dispatchSrc)).not.toMatch(/mock|simulad|fake|dry.?run/i)
  })
})

describe('"enviado" solo con confirmación del proveedor', () => {
  it('2xx con identificador → enviado', () => {
    expect(clasificar(200, { id: 'msg_1' })).toEqual({ resultado: 'enviado', id: 'msg_1' })
  })
  it('2xx SIN identificador → incierto, nunca enviado', () => {
    expect(clasificar(200, {}).resultado).toBe('incierto')
    expect(clasificar(202, { id: '  ' }).resultado).toBe('incierto')
    expect(clasificar(200, null).resultado).toBe('incierto')
  })
  it('rechazo definitivo del proveedor → fallido', () => {
    for (const s of [400, 401, 403, 404, 422]) expect(clasificar(s, { message: 'x' }).resultado).toBe('fallido')
  })
  it('lo que NO prueba que el correo no salió → incierto', () => {
    for (const s of [408, 409, 425, 429, 500, 502, 503, 504]) expect(clasificar(s, {}).resultado).toBe('incierto')
  })
  it('el despachador solo pasa identificador cuando el envío fue confirmado', () => {
    const c = soloCodigo(dispatchSrc)
    expect(c).toMatch(/if \(env\.resultado === 'enviado'\) messageId = env\.id/)
    expect(c).toMatch(/let messageId: string \| null = null/)
  })
  it('y la base lo impone por esquema, no por buena voluntad del código', () => {
    expect(migSrc).toMatch(/constraint ck_comm_enviado check \(\s*\(status = 'enviado'\) = \(provider_message_id is not null and sent_at is not null\)\)/)
    expect(migSrc).toMatch(/COMM_SIN_CONFIRMACION/)
  })
})

describe('un corte no es ni éxito ni rechazo', () => {
  it('la red revienta → incierto', async () => {
    const r = await enviarCorreo(CFG, MSG, () => Promise.reject(new Error('ECONNRESET')))
    expect(r.resultado).toBe('incierto')
  })
  it('timeout → incierto', async () => {
    const abortado = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const r = await enviarCorreo(CFG, MSG, () => Promise.reject(abortado))
    expect(r).toEqual({ resultado: 'incierto', error: 'timeout' })
    expect(TIMEOUT_CORREO_MS).toBeGreaterThan(0)
  })
  it('un 500 del proveedor → incierto, y la base decide si reintenta', async () => {
    const r = await enviarCorreo(CFG, MSG, () => resp(500, { message: 'internal' }))
    expect(r.resultado).toBe('incierto')
  })
  it('éxito real → enviado con el id del proveedor', async () => {
    const r = await enviarCorreo(CFG, MSG, () => resp(200, { id: 'msg_42' }))
    expect(r).toEqual({ resultado: 'enviado', id: 'msg_42' })
  })
})

describe('W4-06 · el mismo hecho viaja siempre con la misma llave', () => {
  it('la llave de idempotencia va al proveedor en su cabecera', async () => {
    const f = vi.fn((_u: string, _i: RequestInit) => resp(200, { id: 'm' }))
    await enviarCorreo(CFG, MSG, f)
    const init = f.mock.calls[0][1]
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('pago_recibido:abc:1')
  })
  it('un reintento del MISMO mensaje manda exactamente la misma llave', async () => {
    const llaves: string[] = []
    const f = (_u: string, i: RequestInit) => { llaves.push((i.headers as Record<string, string>)['Idempotency-Key']); return resp(503, {}) }
    await enviarCorreo(CFG, MSG, f); await enviarCorreo(CFG, MSG, f); await enviarCorreo(CFG, MSG, f)
    expect(new Set(llaves).size).toBe(1)
  })
  it('la llave NO la inventa el despachador: es la que devuelve la base', () => {
    const c = soloCodigo(dispatchSrc)
    expect(c).toMatch(/llaveIdempotencia: m\.idempotency_key/)
    expect(c).not.toMatch(/randomUUID|Math\.random|Date\.now/)
  })
  it('en la base la llave es el hecho canónico + generación, y el hecho es único', () => {
    expect(migSrc).toMatch(/constraint uq_comm_event unique \(event_key\)/)
    expect(migSrc).toMatch(/c\.event_key \|\| ':' \|\| c\.generacion/)
    expect(migSrc).toMatch(/on conflict \(event_key\) do nothing/)
    // Los hechos: el id del pedido o el id del COBRO; nunca un valor del navegador.
    expect(migSrc).toMatch(/'pago_recibido:' \|\| new\.id/)
    expect(migSrc).toMatch(/'pedido_recibido:' \|\| new\.id/)
  })
  it('lo incierto se reintenta solo dentro de la ventana segura del proveedor', () => {
    expect(migSrc).toMatch(/_comm_ventana_idempotencia\(\) returns interval[\s\S]{0,120}interval '20 hours'/)
    expect(migSrc).toMatch(/c\.first_attempt_at > now\(\) - public\._comm_ventana_idempotencia\(\)/)
    expect(migSrc).toMatch(/COMM_POSIBLE_DUPLICADO/)
  })
})

describe('las credenciales no salen del adaptador', () => {
  it('un error del proveedor que repite la llave se guarda sin ella', async () => {
    const r = await enviarCorreo(CFG, MSG, () => resp(401, { message: `invalid key re_SECRETO_123 for Bearer re_SECRETO_123` }))
    expect(r.resultado).toBe('fallido')
    if (r.resultado !== 'enviado') { expect(r.error).not.toContain('re_SECRETO_123'); expect(r.error).toContain('***') }
  })
  it('sanitiza acota la longitud', () => { expect(sanitiza('x'.repeat(900), CFG).length).toBeLessThanOrEqual(240) })
  it('el despachador no usa la llave de servicio: actúa con el permiso de quien lo invoca', () => {
    expect(soloCodigo(dispatchSrc)).not.toMatch(/SERVICE_ROLE/)
    expect(soloCodigo(dispatchSrc)).toMatch(/Authorization: req\.headers\.get\('Authorization'\)/)
  })
  it('ni registra nada en consola', () => {
    expect(soloCodigo(dispatchSrc) + soloCodigo(correoSrc)).not.toMatch(/console\.(log|warn|error|info)/)
  })
})

describe('plantillas: vocabulario cerrado y texto limpio', () => {
  it('las seis plantillas son exactamente las que la base sabe encolar', () => {
    const enBase = [...migSrc.matchAll(/'(pedido_\w+|pago_recibido|reembolso_realizado)'/g)].map((m) => m[1])
    for (const p of PLANTILLAS) expect(enBase).toContain(p)
    expect(PLANTILLAS).toHaveLength(6)
  })
  it('todas se arman, incluso sin datos, sin dejar "undefined", "null" ni "NaN"', () => {
    for (const p of PLANTILLAS) {
      const r = renderizar(p, {}, null)
      for (const t of [r.asunto, r.texto, r.html]) expect(t).not.toMatch(/undefined|null|NaN/)
      expect(r.asunto.length).toBeGreaterThan(5)
    }
  })
  it('una plantilla desconocida no se envía: revienta', () => {
    expect(() => renderizar('promo_de_temporada', {})).toThrow(/PLANTILLA_DESCONOCIDA/)
    expect(esPlantilla('promo_de_temporada')).toBe(false)
  })
  it('el nombre del cliente no puede inyectar HTML', () => {
    const r = renderizar('pedido_recibido', { folio: 'S1' }, '<script>alert(1)</script>')
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('&lt;script&gt;')
  })
  it('usa la foto del hecho: folio, monto y rastreo', () => {
    expect(renderizar('pedido_recibido', { folio: 'S123456', total: 4350 }, 'Dra. Ana').texto).toMatch(/pedido S123456 por \$4,350\.00/)
    expect(renderizar('pago_recibido', { folio: 'S1', monto: 1000, metodo: 'transferencia' }).texto).toMatch(/pago de \$1,000\.00 por transferencia/)
    expect(renderizar('pedido_enviado', { folio: 'S1', paqueteria: 'DHL', rastreo: '123' }).texto).toMatch(/Viaja por DHL, con número de rastreo 123/)
    expect(renderizar('pedido_enviado', { folio: 'S1', metodo: 'chofer' }).texto).toMatch(/nuestro equipo de entregas/)
  })
  it('no promete lo que el sistema no sabe: la cancelación no afirma un reembolso hecho', () => {
    expect(renderizar('pedido_cancelado', { folio: 'S1' }).texto).toMatch(/nos pondremos en contacto/)
    expect(renderizar('pedido_cancelado', { folio: 'S1' }).texto).not.toMatch(/reembolso (fue|ha sido) realizado/)
  })
})

describe('comunicar jamás tumba una operación de negocio', () => {
  it('el encolado atrapa cualquier error y solo deja una advertencia', () => {
    const i = migSrc.indexOf('create function public._comm_encolar')
    const cuerpo = migSrc.slice(i, migSrc.indexOf('create function public._comm_tr_orders'))
    expect(cuerpo).toMatch(/exception when others then/)
    expect(cuerpo).toMatch(/raise warning 'COMM_ENCOLAR_FALLO/)
    expect(cuerpo).not.toMatch(/raise exception/)
  })
  it('los disparadores son AFTER: nunca deciden si la operación ocurre', () => {
    const tr = [...migSrc.matchAll(/create trigger (trg_comm_\w+) (before|after) /g)].filter((m) => m[1] !== 'trg_comm_outbox_guard')
    expect(tr).toHaveLength(3)
    for (const m of tr) expect(m[2]).toBe('after')
  })
})

// R4-B2-2 · despacho seguro (WhatsApp y Meta) con proveedores FALSOS: sin red, sin Meta real.
// Clasificación de resultados, verificación antes de CADA POST (pausa entre dos mensajes del lote), timeout → incierto sin
// reintento, rechazo definitivo, falla de la verificación → se retiene (falla cerrado), sin llaves → no hace nada.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { clasificarEnvio, resultadoDeExcepcion, lineaResolucion } from '../../../../../supabase/functions/_shared/salidaClase'
import { despacharWhatsApp } from '../../../../../supabase/functions/_shared/whatsappEnvio'
import { despacharMeta } from '../../../../../supabase/functions/_shared/metaEnvio'

const ENV: Record<string, string> = { WHATSAPP_TOKEN: 't-falso', WHATSAPP_PHONE_ID: '123456789', META_PAGE_TOKEN: 'p-falso', META_PAGE_ID: '987654321' }
beforeEach(() => { vi.stubGlobal('Deno', { env: { get: (k: string) => ENV[k] } }) })

type Llamada = { fn: string; args: Record<string, unknown> }
function adminFalso(lote: unknown[], puede: Array<boolean | 'error'>) {
  const llamadas: Llamada[] = []; let i = 0
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args })
      if (fn.endsWith('_reclamar')) return { data: lote, error: null }
      if (fn.endsWith('_puede_enviar')) { const v = puede[i++]; return v === 'error' ? { data: null, error: { message: 'x' } } : { data: v, error: null } }
      return { data: null, error: null }
    },
  }
  return { admin, llamadas, resoluciones: () => llamadas.filter((l) => l.fn.endsWith('_resolver')).map((l) => l.args) }
}
const respuesta = (status: number, cuerpo: unknown) => Promise.resolve(new Response(JSON.stringify(cuerpo), { status }))

describe('clasificarEnvio', () => {
  it('2xx con id: enviado', () => expect(clasificarEnvio(200, {}, 'wamid.X')).toEqual({ ok: true, id: 'wamid.X' }))
  it('2xx SIN id: incierto (Meta respondió pero no sabemos si lo aceptó)', () => expect(clasificarEnvio(200, {}, undefined)).toMatchObject({ ok: false, clase: 'incierto' }))
  it('400 permiso (10) / fuera de ventana (131047): definitivo', () => {
    expect(clasificarEnvio(400, { error: { code: 10, message: 'Application does not have permission' } }, undefined)).toMatchObject({ clase: 'definitivo' })
    expect(clasificarEnvio(400, { error: { code: 131047, message: 'Re-engagement message' } }, undefined)).toMatchObject({ clase: 'definitivo' })
  })
  it('429 y códigos de cupo: reintentable (Meta no lo envió)', () => {
    expect(clasificarEnvio(429, {}, undefined)).toMatchObject({ clase: 'reintentable' })
    expect(clasificarEnvio(400, { error: { code: 130429 } }, undefined)).toMatchObject({ clase: 'reintentable' })
    expect(clasificarEnvio(400, { error: { code: 131056 } }, undefined)).toMatchObject({ clase: 'reintentable' })
  })
  it('5xx y errores genéricos de Meta: incierto', () => {
    expect(clasificarEnvio(500, {}, undefined)).toMatchObject({ clase: 'incierto' })
    expect(clasificarEnvio(503, { error: { code: 2 } }, undefined)).toMatchObject({ clase: 'incierto' })
    expect(clasificarEnvio(400, { error: { code: 131000 } }, undefined)).toMatchObject({ clase: 'incierto' })
  })
  it('conserva código, subcódigo y trace para conciliar; sin el token', () => {
    const r = clasificarEnvio(400, { error: { code: 100, error_subcode: 2494010, message: 'Invalid  parameter', fbtrace_id: 'AbC123' } }, undefined)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.detalle).toBe('Meta 400 (100/2494010): Invalid parameter [trace AbC123]'); expect(r.detalle).not.toMatch(/t-falso/) }
  })
  it('excepción: timeout y red → incierto', () => {
    const ab = new Error('x'); ab.name = 'AbortError'
    expect(resultadoDeExcepcion(ab)).toEqual({ ok: false, clase: 'incierto', detalle: 'sin respuesta de Meta (timeout)' })
    expect(resultadoDeExcepcion(new TypeError('fetch failed'))).toMatchObject({ clase: 'incierto' })
  })
  it('línea para la base: clase|detalle, máximo 300', () => expect(lineaResolucion('definitivo', 'x'.repeat(400))).toHaveLength(300))
})

describe('despacharWhatsApp', () => {
  const lote = [{ id: 'S1', wa_id: '5216671112233', texto: 'uno' }, { id: 'S2', wa_id: '5216671112233', texto: 'dos' }]
  it('pausa ENTRE dos mensajes del lote: el primero sale, el segundo se retiene sin POST', async () => {
    const f = adminFalso(lote, [true, false])
    const fetchF = vi.fn(() => respuesta(200, { messages: [{ id: 'wamid.1' }] }))
    const r = await despacharWhatsApp(f.admin, fetchF as unknown as typeof fetch)
    expect(fetchF).toHaveBeenCalledTimes(1)
    expect(f.resoluciones()).toEqual([
      { p_id: 'S1', p_ok: true, p_wamid: 'wamid.1', p_error: null },
      { p_id: 'S2', p_ok: false, p_wamid: null, p_error: 'retener|canal pausado o fuera de activo antes del envío' },
    ])
    expect(r).toEqual({ enviados: 1, fallidos: 0, retenidos: 1, inciertos: 0 })
    // orden: verificar ANTES de cada POST
    const orden = f.llamadas.map((l) => l.fn)
    expect(orden).toEqual(['cc_wa_salida_reclamar', 'cc_wa_salida_puede_enviar', 'cc_wa_salida_resolver', 'cc_wa_salida_puede_enviar', 'cc_wa_salida_resolver'])
  })
  it('falla la verificación previa (RPC con error): se retiene, no se envía (falla cerrado)', async () => {
    const f = adminFalso([lote[0]], ['error'])
    const fetchF = vi.fn()
    await despacharWhatsApp(f.admin, fetchF as unknown as typeof fetch)
    expect(fetchF).not.toHaveBeenCalled()
    expect(f.resoluciones()[0].p_error).toMatch(/^retener\|/)
  })
  it('timeout: incierto, UN solo POST (sin reintento)', async () => {
    const f = adminFalso([lote[0]], [true])
    const fetchF = vi.fn(() => { const e = new Error('abort'); e.name = 'AbortError'; return Promise.reject(e) })
    const r = await despacharWhatsApp(f.admin, fetchF as unknown as typeof fetch)
    expect(fetchF).toHaveBeenCalledTimes(1)
    expect(f.resoluciones()[0]).toEqual({ p_id: 'S1', p_ok: false, p_wamid: null, p_error: 'incierto|sin respuesta de Meta (timeout)' })
    expect(r.inciertos).toBe(1)
  })
  it('rechazo definitivo (400/10): fallido con su código', async () => {
    const f = adminFalso([lote[0]], [true])
    const fetchF = vi.fn(() => respuesta(400, { error: { code: 10, message: 'Application does not have permission for this action' } }))
    const r = await despacharWhatsApp(f.admin, fetchF as unknown as typeof fetch)
    expect(f.resoluciones()[0].p_error).toBe('definitivo|Meta 400 (10): Application does not have permission for this action')
    expect(r.fallidos).toBe(1)
  })
  it('sin llaves: no reclama ni envía', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const f = adminFalso(lote, [true, true]); const fetchF = vi.fn()
    await despacharWhatsApp(f.admin, fetchF as unknown as typeof fetch)
    expect(f.llamadas).toHaveLength(0); expect(fetchF).not.toHaveBeenCalled()
  })
})

describe('despacharMeta', () => {
  const lote = [{ id: 'M1', canal: 'instagram', psid: '1784', texto: 'hola' }, { id: 'M2', canal: 'messenger', psid: '2784', texto: 'hola' }]
  it('verifica antes de cada POST; un 5xx queda incierto; la pausa del segundo lo retiene', async () => {
    const f = adminFalso(lote, [true, false])
    const fetchF = vi.fn(() => respuesta(502, {}))
    const r = await despacharMeta(f.admin, fetchF as unknown as typeof fetch)
    expect(fetchF).toHaveBeenCalledTimes(1)
    expect(f.resoluciones()).toEqual([
      { p_id: 'M1', p_ok: false, p_mid: null, p_error: 'incierto|Meta 502: sin detalle' },
      { p_id: 'M2', p_ok: false, p_mid: null, p_error: 'retener|canal pausado o fuera de activo antes del envío' },
    ])
    expect(r).toEqual({ enviados: 0, fallidos: 0, retenidos: 1, inciertos: 1 })
  })
  it('aceptado: usa message_id', async () => {
    const f = adminFalso([lote[0]], [true])
    await despacharMeta(f.admin, vi.fn(() => respuesta(200, { message_id: 'm_1' })) as unknown as typeof fetch)
    expect(f.resoluciones()[0]).toEqual({ p_id: 'M1', p_ok: true, p_mid: 'm_1', p_error: null })
  })
})

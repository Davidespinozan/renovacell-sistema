// INVITA-1 · lógica pura del envío masivo: plantilla de WhatsApp, clasificación del resultado (cliente vs. canal) y
// cliente RPC (nombres de comandos, errores traducidos).
import { describe, expect, it } from 'vitest'
import { asientoCorreo, asientoWhatsApp, cuerpoPlantillaInvitacion } from '../../../../../supabase/functions/_shared/invitacionMasiva'
import { clasificarEnvio } from '../../../../../supabase/functions/_shared/salidaClase'
import { ClienteInvitacionesMasivas, diasEstimados, mensajeError, TEXTO_PLANTILLA_WA } from './invitacionesMasivas'

describe('INVITA-1 · plantilla de WhatsApp', () => {
  it('manda al número con lada 52, plantilla, idioma y dos variables (nombre bonito y enlace)', () => {
    const c = cuerpoPlantillaInvitacion('6671234567', 'invitacion_cuenta', 'es_MX', 'DRA. MARIA DE LA LUZ', 'https://x/invitacion#tok') as any
    expect(c.to).toBe('526671234567')
    expect(c.type).toBe('template')
    expect(c.template.name).toBe('invitacion_cuenta')
    expect(c.template.language.code).toBe('es_MX')
    expect(c.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(['Dra. Maria de la Luz', 'https://x/invitacion#tok'])
  })
  it('sin nombre usable saluda genérico', () => {
    const c = cuerpoPlantillaInvitacion('6671234567', 'p', 'es_MX', 'x@y.com', 'u') as any
    expect(c.template.components[0].parameters[0].text).toBe('doctor(a)')
  })
  it('el texto sugerido usa exactamente {{1}} y {{2}}', () => {
    expect(TEXTO_PLANTILLA_WA.match(/\{\{\d\}\}/g)).toEqual(['{{1}}', '{{2}}'])
  })
})

describe('INVITA-1 · resultado de WhatsApp', () => {
  const meta = (status: number, code?: number) => clasificarEnvio(status, code === undefined ? { messages: [{ id: 'wamid.X' }] } : { error: { code, message: 'x' } }, code === undefined ? 'wamid.X' : undefined)
  it('aceptado → enviado con su wamid', () => expect(asientoWhatsApp(meta(200))).toEqual({ resultado: 'enviado', id: 'wamid.X' }))
  it('plantilla inexistente / no aprobada / parámetros → retener (pausa la campaña, no quema la lista)', () => {
    for (const code of [132001, 132000, 132015, 190, 10]) expect(asientoWhatsApp(meta(400, code)).resultado).toBe('retener')
  })
  it('límite de Meta → retener', () => expect(asientoWhatsApp(meta(429, 130429)).resultado).toBe('retener'))
  it('número sin WhatsApp → fallido (solo ese cliente)', () => expect(asientoWhatsApp(meta(400, 131026)).resultado).toBe('fallido'))
  it('5xx o sin respuesta → incierto (no se reenvía)', () => expect(asientoWhatsApp(meta(500, 1)).resultado).toBe('incierto'))
})

describe('INVITA-1 · resultado del correo', () => {
  it('credencial o dominio → retener; dirección rechazada → fallido', () => {
    expect(asientoCorreo({ resultado: 'fallido', error: 'rechazado 403: The domain is not verified' }).resultado).toBe('retener')
    expect(asientoCorreo({ resultado: 'fallido', error: 'rechazado 401: API key is invalid' }).resultado).toBe('retener')
    expect(asientoCorreo({ resultado: 'fallido', error: 'rechazado 422: Invalid `to` field' }).resultado).toBe('fallido')
    expect(asientoCorreo({ resultado: 'enviado', id: 're_1' })).toEqual({ resultado: 'enviado', id: 're_1' })
    expect(asientoCorreo({ resultado: 'incierto', error: 'proveedor 429: daily quota' }).resultado).toBe('retener')
    expect(asientoCorreo({ resultado: 'incierto', error: 'timeout' }).resultado).toBe('incierto')
  })
})

describe('INVITA-1 · cliente RPC', () => {
  it('usa los comandos de la base con sus parámetros', async () => {
    const llamadas: Array<[string, unknown]> = []
    const c = new ClienteInvitacionesMasivas(async (fn, args) => { llamadas.push([fn, args]); return { data: { ok: 1 }, error: null } })
    await c.previa('correo', { seller: 's1', sinVendedor: false })
    await c.crear('whatsapp', { seller: null, sinVendedor: true }, 200, 'invitacion_cuenta')
    await c.cambiar('c1', 'pausar')
    expect(llamadas).toEqual([
      ['invitaciones_masivas_previa', { p_canal: 'correo', p_seller: 's1', p_sin_vendedor: false }],
      ['invitaciones_masivas_crear', { p_canal: 'whatsapp', p_seller: null, p_sin_vendedor: true, p_limite_diario: 200, p_plantilla: 'invitacion_cuenta', p_idioma: 'es_MX' }],
      ['invitaciones_masivas_cambiar', { p_campana: 'c1', p_accion: 'pausar' }],
    ])
  })
  it('traduce los errores de la base', async () => {
    const c = new ClienteInvitacionesMasivas(async () => ({ data: null, error: { message: 'CAMPANA_VIVA: ya hay' } }))
    expect(await c.crear('correo', { seller: null, sinVendedor: false }, 150, null)).toEqual({ ok: false, error: mensajeError('CAMPANA_VIVA') })
    expect(mensajeError('NO_AUTORIZADO')).toMatch(/Solo Dirección/)
  })
  it('días estimados', () => { expect(diasEstimados(1132, 150)).toBe(8); expect(diasEstimados(0, 150)).toBe(0) })
})

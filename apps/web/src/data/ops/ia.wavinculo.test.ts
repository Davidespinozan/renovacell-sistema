// IA MEJOR QUE EL HUMANO · E · WhatsApp vinculado de forma explícita: la IA reconoce al doctor (precios, perfil, pedidos)
// solo si la base lo dice (cc_ia_identidad_canal); sin vínculo, todo como antes. Carrito y checkout siguen en el portal.
import { describe, it, expect } from 'vitest'
import { codigoVinculo } from '../../../../../supabase/functions/_shared/whatsapp'
import { herramientasPara, validarLlamada } from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { ejecutarTurno } from '../../../../../supabase/functions/_shared/ia/orquestador'
import { crearProveedorFalso, respuestaTexto } from '../../../../../supabase/functions/_shared/ia/proveedor'
import webhookSrc from '../../../../../supabase/functions/meta-webhook/index.ts?raw'

const DOC = '55555555-5555-4555-8555-555555555555'
const doctor = { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }

describe('código de vínculo', () => {
  it('solo un mensaje corto con el código', () => {
    expect(codigoVinculo('Conectar mi WhatsApp RC-123456')).toBe('RC-123456')
    expect(codigoVinculo('rc 654321')).toBe('RC-654321')
    expect(codigoVinculo('mi pedido es el 123456')).toBeNull()
    expect(codigoVinculo('hola, quiero 10 botox y también ' + 'x'.repeat(80) + ' RC-123456')).toBeNull()
  })
  it('el webhook vincula ANTES de la IA y no le da ese turno', () => {
    const i = webhookSrc.indexOf('const cod = codigoVinculo(m.texto)'); const j = webhookSrc.indexOf('IA_PUEDE(r.modo')
    expect(i).toBeGreaterThan(0); expect(j).toBeGreaterThan(i)
    expect(webhookSrc).toMatch(/admin\.rpc\('cc_wa_vincular', \{ p_wa_id: m\.wa_id, p_codigo: cod, p_conv: r\.conversation_id \}\)[\s\S]{0,300}continue\n/)
  })
})

describe('herramientas y prompt', () => {
  it('con vínculo: sus pedidos sí; carrito y checkout no', () => {
    const con = herramientasPara(true, 'whatsapp', false, true).map((h) => h.name)
    expect(con).toContain('obtener_estado_pedido'); expect(con).toContain('cotizar'); expect(con).not.toContain('agregar_al_carrito'); expect(con).not.toContain('preparar_checkout')
    expect(herramientasPara(true, 'whatsapp').map((h) => h.name)).not.toContain('obtener_estado_pedido')
    expect(validarLlamada('obtener_estado_pedido', {}, { conCuenta: true, idsAutorizados: new Set(), canal: 'whatsapp', identificado: true }).ok).toBe(true)
    expect(validarLlamada('obtener_estado_pedido', {}, { conCuenta: true, idsAutorizados: new Set(), canal: 'whatsapp' })).toEqual({ ok: false, motivo: 'no_autorizada' })
    expect(validarLlamada('agregar_al_carrito', {}, { conCuenta: true, idsAutorizados: new Set(), canal: 'whatsapp', identificado: true })).toEqual({ ok: false, motivo: 'no_autorizada' })
  })
  it('el prompt lo reconoce, vende y cotiza antes de pasar la compra a una persona', () => {
    const s = politica.construirSistema({ ctx: doctor, intencion: 'CHECKOUT', limiteClinico: false, reglasConocimiento: [], evidencia: [], canal: 'whatsapp' })
    expect(s).toContain('El sistema YA LO RECONOCIÓ'); expect(s).not.toMatch(/Trátalo como contacto NO verificado/)
    expect(s).toContain('TAMBIÉN ERES SU VENDEDOR'); expect(s).toMatch(/antes cotiza con cotizar lo que pidió/)
    const anon = politica.construirSistema({ ctx: { ...doctor, actor: 'visitor', audiencia: 'public', verificado: false, puede_precio: false }, intencion: 'PRICE', limiteClinico: false, reglasConocimiento: [], evidencia: [], canal: 'whatsapp' })
    expect(anon).toMatch(/Trátalo como contacto NO verificado/); expect(anon).not.toContain('YA LO RECONOCIÓ')
  })
})

describe('turno en WhatsApp', () => {
  const correr = async (identidad: string | null) => {
    const llamadas: Array<[string, Record<string, unknown>]> = []
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      llamadas.push([fn, args])
      if (fn === 'cc_ia_identidad_canal') return { data: identidad, error: null }
      if (fn === 'cc_ia_contexto_actor') return { data: args.p_profile ? doctor : { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      if (fn === 'cc_ia_turno_reclamar') return { data: { estado: 'reclamado', turn_id: 't1' }, error: null }
      if (fn === 'cc_ia_turno_responder') return { data: { persistido: true }, error: null }
      if (fn === 'cc_ia_perfil_comercial') return { data: { tipo: 'doctor' }, error: null }
      return { data: null, error: null }
    }
    const proveedor = crearProveedorFalso([respuestaTexto('¡Hola, doctor!')])
    await ejecutarTurno({ conv: 'c1', triggerSeq: 1, actor: 'visitor', profile: null, visitorHash: 'h', textoUsuario: 'hola', canal: 'whatsapp' },
      { rpc, leerMensajes: async () => [], proveedor, config: { maxTokens: 600, timeoutMs: 20_000, maxRondas: 2, historial: 6 }, politica, herramientas, validacion, reglasConocimiento: [] })
    return { llamadas, system: proveedor.solicitudes[0]?.system ?? '' }
  }
  it('con vínculo: contexto y perfil del doctor que dice la base', async () => {
    const r = await correr(DOC)
    expect(r.llamadas.find(([f]) => f === 'cc_ia_contexto_actor')?.[1]).toEqual({ p_profile: DOC })
    expect(r.llamadas.some(([f]) => f === 'cc_ia_perfil_comercial')).toBe(true)
    expect(r.system).toContain('perfil_comercial_del_cliente')
  })
  it('sin vínculo: público, como siempre', async () => {
    const r = await correr(null)
    expect(r.llamadas.find(([f]) => f === 'cc_ia_contexto_actor')?.[1]).toEqual({ p_profile: null })
    expect(r.llamadas.some(([f]) => f === 'cc_ia_perfil_comercial')).toBe(false)
  })
})

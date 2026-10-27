// R4-C15 · "Me puedes enviar tu lista de precios" es oportunidad de venta (asesor), y cuando la IA decide pasar la conversación
// en el canal, el cliente no recibe "Pediste hablar con un asesor" (no lo pidió): traspaso con aviso interno + la IA lo dice.
import { describe, it, expect } from 'vitest'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { ejecutarTurno, type DepsOrquestador } from '../../../../../supabase/functions/_shared/ia/orquestador'
import { crearProveedorFalso, respuestaTexto, respuestaHerramientas } from '../../../../../supabase/functions/_shared/ia/proveedor'

describe('lista de precios = atención comercial', () => {
  for (const t of ['Me puedes enviar tu lista de precios xfavor', 'mándame la lista de precio', '¿tienen catálogo con precios?', 'precios de todos los productos'])
    it(`«${t}»`, () => { expect(politica.atencionComercial(t)).toBe('negociacion'); expect(politica.clasificarIntencionCanal(t)).toBe('CHECKOUT') })
  it('una pregunta de precio de un producto sigue siendo informativa', () => expect(politica.atencionComercial('¿cuánto cuesta el nabota?')).toBeNull())
})

describe('la IA pasa la conversación en el canal', () => {
  function correr(canal: 'whatsapp' | 'portal') {
    const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
    const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
      llamadas.push({ fn, args })
      if (fn === 'cc_ia_contexto_actor') return { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      if (fn === 'cc_ia_turno_reclamar') return { data: { estado: 'reclamado', turn_id: 't1', operation_id: 'ai:5', attempts: 1 }, error: null }
      if (fn === 'cc_ia_estado_handoff') return { data: { horario_configurado: true, en_horario: true, modo: 'ai_active' }, error: null }
      if (fn === 'cc_solicitar_asesor') return { data: { modo: 'human_requested', asesor: true, idempotente: canal !== 'portal' }, error: null }
      if (fn === 'cc_ia_turno_responder') return { data: { persistido: true, idempotente: false }, error: null }
      return { data: canal !== 'portal' && fn === '_cc_canal_transferir' ? true : [], error: null }
    }
    const pol = canal === 'portal' ? politica : { ...politica, clasificarIntencion: politica.clasificarIntencionCanal }
    const d = { rpc, leerMensajes: async () => [{ actor: 'visitor', content: '¿Van a estar en el Step Up?' }], proveedor: crearProveedorFalso([respuestaHerramientas([{ name: 'solicitar_asesor', input: {} }]), respuestaTexto('Te paso con un asesor que te confirma lo del Step Up.')]),
      config: { maxTokens: 300, timeoutMs: 20_000, maxRondas: 3, historial: 12 }, politica: pol, herramientas, validacion, reglasConocimiento: [] } as unknown as DepsOrquestador
    return { d, llamadas }
  }
  it('canal: primero el traspaso con aviso interno (prefijo comercial), luego cc_solicitar_asesor idempotente', async () => {
    const { d, llamadas } = correr('whatsapp')
    await ejecutarTurno({ conv: 'c', triggerSeq: 5, actor: 'visitor', profile: null, visitorHash: 'h'.repeat(64), textoUsuario: '¿Van a estar en el Step Up?', canal: 'whatsapp' }, d)
    const fns = llamadas.map((l) => l.fn)
    expect(fns.indexOf('_cc_canal_transferir')).toBeGreaterThan(-1); expect(fns.indexOf('_cc_canal_transferir')).toBeLessThan(fns.indexOf('cc_solicitar_asesor'))
    expect(llamadas.find((l) => l.fn === '_cc_canal_transferir')!.args).toEqual({ p_conv: 'c', p_origen: 'whatsapp', p_prefijo: 'comercial', p_motivo: 'ia_transfiere', p_respiro: false })
  })
  it('portal: como siempre (solo cc_solicitar_asesor)', async () => {
    const { d, llamadas } = correr('portal')
    await ejecutarTurno({ conv: 'c', triggerSeq: 5, actor: 'visitor', profile: null, visitorHash: 'h'.repeat(64), textoUsuario: 'quiero un asesor', canal: 'portal' }, d)
    expect(llamadas.some((l) => l.fn === '_cc_canal_transferir')).toBe(false); expect(llamadas.some((l) => l.fn === 'cc_solicitar_asesor')).toBe(true)
  })
})

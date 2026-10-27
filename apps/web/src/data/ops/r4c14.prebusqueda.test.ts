// R4-C14 · "TNM" nunca más sin reconocer: en el canal, los productos que el cliente nombra se buscan en el catálogo ANTES
// del modelo (coincidencias fuertes ≥ 75), se le entregan como DATA y cuentan como consultados para el validador. El portal no
// cambia. Caso real: clienta del 27 oct 2026 escribió "Tnm". Sin red.
import { describe, it, expect } from 'vitest'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { ejecutarTurno, type DepsOrquestador } from '../../../../../supabase/functions/_shared/ia/orquestador'
import { crearProveedorFalso, respuestaTexto } from '../../../../../supabase/functions/_shared/ia/proveedor'

const TNM = { product_id: '44444444-4444-4444-8444-444444444444', nombre: 'TNM', familia: 'TNM', categoria: 'Vitaminas', es_familia: false, coincidencia: 'nombre', puntaje: 90 }
const DEBIL = { product_id: '55555555-5555-4555-8555-555555555555', nombre: 'Numerol 10 ml', familia: 'X', categoria: 'Y', es_familia: false, coincidencia: 'nombre_contiene', puntaje: 60 }

describe('palabras que se buscan', () => {
  it('"Tnm" → tnm; frases comunes no generan búsquedas', () => {
    expect(politica.palabrasDeProducto('Tnm')).toEqual(['tnm'])
    expect(politica.palabrasDeProducto('Quisiera comprar Nabota')).toEqual(['nabota'])
    expect(politica.palabrasDeProducto('Buen día. Gracias, porfavor')).toEqual([])
    expect(politica.palabrasDeProducto('quiero 2 cajas de hyalux deep')).toEqual(['hyalux deep', 'hyalux', 'deep'])
  })
  it('solo coincidencias fuertes y sin repetir producto', async () => {
    const pre = await politica.prebuscarProductos('tnm numerol', async (q) => ({ data: q === 'tnm' ? [TNM] : [DEBIL, TNM], error: null }))
    expect(pre.map((p) => p.nombre)).toEqual(['TNM'])
    expect(await politica.prebuscarProductos('tnm', async () => { throw new Error('red') })).toEqual([])
  })
})

describe('el turno ya trae el producto', () => {
  function deps(canal: boolean) {
    const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
    const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
      llamadas.push({ fn, args })
      if (fn === 'cc_ia_contexto_actor') return { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      if (fn === 'cc_ia_turno_reclamar') return { data: { estado: 'reclamado', turn_id: 't1', operation_id: 'ai:7', attempts: 1 }, error: null }
      if (fn === 'cc_ia_estado_handoff') return { data: { horario_configurado: true, en_horario: true, modo: 'ai_active' }, error: null }
      if (fn === 'cc_catalogo_para_ia') return { data: [{ product_id: TNM.product_id, nombre: 'TNM' }], error: null }
      if (fn === 'cc_buscar_productos') return { data: [TNM], error: null }
      if (fn === 'cc_ia_turno_responder') return { data: { persistido: true, idempotente: false }, error: null }
      return { data: 'ok', error: null }
    }
    const pol = canal ? { ...politica, clasificarIntencion: politica.clasificarIntencionCanal } : politica
    const val = canal ? { ...validacion, respuestaSegura: validacion.respuestaSeguraCanal } : validacion
    const d = { rpc, leerMensajes: async () => [{ actor: 'visitor', content: 'Tnm' }], proveedor: crearProveedorFalso([respuestaTexto('¡Claro! Manejamos TNM. ¿Cuántas piezas necesitas?'), respuestaTexto('x')]),
      config: { maxTokens: 300, timeoutMs: 20_000, maxRondas: 3, historial: 12 }, politica: pol, herramientas, validacion: val, reglasConocimiento: [] } as unknown as DepsOrquestador & { proveedor: ReturnType<typeof crearProveedorFalso> }
    return { d, llamadas }
  }
  it('canal: busca "tnm" antes del modelo, se lo da como DATA y la respuesta que nombra TNM SÍ pasa', async () => {
    const { d, llamadas } = deps(true)
    const r = await ejecutarTurno({ conv: 'c', triggerSeq: 7, actor: 'visitor', profile: null, visitorHash: 'h'.repeat(64), textoUsuario: 'Tnm', canal: 'whatsapp' }, d)
    expect(llamadas.find((l) => l.fn === 'cc_buscar_productos')!.args).toEqual({ p_q: 'tnm', p_limite: 5, p_audiencia: 'public' })
    expect(d.proveedor.solicitudes[0].system).toContain('productos_del_catalogo_que_menciono_el_cliente'); expect(d.proveedor.solicitudes[0].system).toContain('"TNM"')
    expect(r.estado).toBe('respondio'); expect(d.proveedor.solicitudes).toHaveLength(1)
    expect(String(llamadas.find((l) => l.fn === 'cc_ia_turno_responder')!.args.p_content)).toBe('¡Claro! Manejamos TNM. ¿Cuántas piezas necesitas?')
  })
  it('portal: sin pre-búsqueda (sin cambios)', async () => {
    const { d, llamadas } = deps(false)
    await ejecutarTurno({ conv: 'c', triggerSeq: 7, actor: 'visitor', profile: null, visitorHash: 'h'.repeat(64), textoUsuario: 'Tnm', canal: 'portal' }, d)
    expect(llamadas.some((l) => l.fn === 'cc_buscar_productos')).toBe(false)
  })
})

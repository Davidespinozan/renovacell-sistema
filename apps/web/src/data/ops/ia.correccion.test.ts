// EXAMEN (2 nov 2026) · lo que encontró el examen: frases de precio se rechazaban como "existencias" y cualquier rechazo
// mandaba un texto genérico que no contestaba. Ahora la regla es precisa y hay UNA corrección interna antes del texto seguro.
import { describe, it, expect } from 'vitest'
import { validarRespuesta } from '../../../../../supabase/functions/_shared/ia/validacion'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { ejecutarTurno } from '../../../../../supabase/functions/_shared/ia/orquestador'
import { crearProveedorFalso, respuestaHerramientas, respuestaTexto } from '../../../../../supabase/functions/_shared/ia/proveedor'

const A = '11111111-1111-4111-8111-111111111111'
const ok = (t: string, evidencia: string[] = ['PRICE_EVIDENCE']) => validarRespuesta(t, { evidencia, nombresAutorizados: [], nombresCatalogo: [], limiteClinico: false })

describe('regla de existencias precisa', () => {
  it('las frases de precio por cantidad ya no son "existencias"', () => {
    expect(ok('Si llevas 5 piezas te queda a $4,370 cada una.')).toMatchObject({ ok: true })
    expect(ok('Desde 10 unidades hay medio mayoreo a $1,170.')).toMatchObject({ ok: true })
  })
  it('una afirmación de inventario sí se rechaza sin evidencia', () => {
    for (const t of ['Tenemos 30 piezas listas.', 'Sí, hay existencia de Botox.', 'Está agotado por ahora.', 'Nos quedan 4 cajas.']) expect(ok(t)).toMatchObject({ ok: false, motivo: 'stock_sin_evidencia' })
    expect(ok('Tenemos 30 piezas listas.', ['STOCK_EVIDENCE'])).toMatchObject({ ok: true })
  })
})

function db(perfil: Record<string, unknown> | null = null) {
  return async (fn: string) => {
    if (fn === 'cc_ia_contexto_actor') return { data: { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }, error: null }
    if (fn === 'cc_ia_turno_reclamar') return { data: { estado: 'reclamado', turn_id: 't1' }, error: null }
    if (fn === 'cc_ia_turno_responder') return { data: { persistido: true }, error: null }
    if (fn === 'cc_buscar_productos') return { data: [{ product_id: A, nombre: 'Botox 100 UI' }], error: null }
    if (fn === 'cc_ia_precio') return { data: { autorizado: true, product_id: A, nombre: 'Botox 100 UI', precio_unitario: 4600 }, error: null }
    if (fn === 'cc_ia_perfil_comercial') return { data: perfil ?? { tipo: 'doctor' }, error: null }
    return { data: null, error: null }
  }
}
const turno = async (guion: Parameters<typeof crearProveedorFalso>[0], perfil: Record<string, unknown> | null = null) => {
  const persistidos: string[] = []
  const base = db(perfil)
  const rpc = async (fn: string, args: Record<string, unknown>) => { if (fn === 'cc_ia_turno_responder') persistidos.push(String(args.p_content)); return base(fn) }
  const proveedor = crearProveedorFalso(guion)
  const r = await ejecutarTurno({ conv: 'c1', triggerSeq: 1, actor: 'doctor', profile: 'p1', visitorHash: null, textoUsuario: 'cuanto el botox', canal: 'portal' },
    { rpc, leerMensajes: async () => [], proveedor, config: { maxTokens: 600, timeoutMs: 20_000, maxRondas: 4, historial: 6 }, politica, herramientas, validacion, reglasConocimiento: [] })
  return { r, persistidos, proveedor }
}

describe('corrección interna antes del texto seguro', () => {
  it('una afirmación sin evidencia se corrige una vez y el doctor recibe la respuesta buena', async () => {
    const { r, persistidos, proveedor } = await turno([
      respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'botox' } }]),
      respuestaHerramientas([{ name: 'obtener_precio', input: { product_id: A, cantidad: 1 } }]),
      respuestaTexto('El Botox 100 UI está en $4,600 y tenemos 20 piezas listas.'),
      respuestaTexto('El Botox 100 UI está en $4,600 por pieza. ¿Cuántas necesitas?'),
    ])
    expect(r.estado).toBe('respondio'); expect(r.motivoValidacion).toBeUndefined()
    expect(persistidos).toEqual(['El Botox 100 UI está en $4,600 por pieza. ¿Cuántas necesitas?'])
    expect(proveedor.solicitudes[3].system).toMatch(/ANTES DE RESPONDER[\s\S]*afirmaba existencias/)
  })
  it('si vuelve a fallar, el texto seguro de siempre (nunca se publica lo rechazado)', async () => {
    const { r, persistidos } = await turno([respuestaTexto('Ya lo agregué a tu carrito.')])
    expect(r.motivoValidacion).toBe('carrito_mutacion_sin_evidencia')
    expect(persistidos[0]).not.toMatch(/Ya lo agregué/)
  })
  it('su carrito viene en el perfil: describirlo no es inventarlo', async () => {
    const { persistidos } = await turno([respuestaTexto('En tu carrito tienes 2 Golden Placenta Mask. ¿Lo terminamos?')], { tipo: 'doctor', carrito: [{ product_id: A, nombre: 'Golden Placenta Mask', cantidad: 2 }] })
    expect(persistidos[0]).toBe('En tu carrito tienes 2 Golden Placenta Mask. ¿Lo terminamos?')
  })
})

describe('nunca desechar al cliente (caso Éclat de Vie)', () => {
  it('un contacto sin verificar que pide algo del catálogo profesional recibe "sí lo manejamos", sin id ni precio', async () => {
    const llamadas: Array<[string, Record<string, unknown>]> = []
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      llamadas.push([fn, args])
      if (fn === 'cc_ia_contexto_actor') return { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      if (fn === 'cc_ia_turno_reclamar') return { data: { estado: 'reclamado', turn_id: 't1' }, error: null }
      if (fn === 'cc_ia_turno_responder') return { data: { persistido: true }, error: null }
      if (fn === 'cc_buscar_productos') return { data: args.p_audiencia === 'verified' ? [{ product_id: A, nombre: 'NABOTA 200 UI' }] : [], error: null }
      return { data: null, error: null }
    }
    const proveedor = crearProveedorFalso([respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'nabota 200' } }]), respuestaTexto('¡Sí manejamos NABOTA 200 UI! Te paso con un asesor para tu precio.')])
    const r = await ejecutarTurno({ conv: 'c1', triggerSeq: 1, actor: 'visitor', profile: null, visitorHash: 'h', textoUsuario: 'quiero 3 nabota 200', canal: 'whatsapp' },
      { rpc, leerMensajes: async () => [], proveedor, config: { maxTokens: 600, timeoutMs: 20_000, maxRondas: 4, historial: 6 }, politica, herramientas, validacion, reglasConocimiento: [] })
    expect(r.estado).toBe('respondio'); expect(r.motivoValidacion).toBeUndefined()
    const resultado = JSON.stringify(proveedor.solicitudes[1].messages)
    expect(resultado).toMatch(/solo_para_profesionales/); expect(resultado).toMatch(/NABOTA 200 UI/); expect(resultado).not.toContain(A)
    expect(proveedor.solicitudes[0].system).toMatch(/NUNCA DESECHES A UN CLIENTE/)
  })
})

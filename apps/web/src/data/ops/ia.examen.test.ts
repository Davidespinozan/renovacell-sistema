// IA MEJOR QUE EL HUMANO · A · el examen corre el orquestador real con lecturas reales y escrituras simuladas: ningún
// turno, mensaje, carrito ni asesor se toca; la respuesta, el motivo de validación y lo consultado quedan capturados.
import { describe, it, expect } from 'vitest'
import { rpcExamen, LECTURAS, costoUsd, parsearJuicio, mensajesDelCaso, mensajeJuez, capturarErrores, reintentable, type Caso } from '../../../../../supabase/functions/_shared/ia/examen'
import { ejecutarTurno } from '../../../../../supabase/functions/_shared/ia/orquestador'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { crearProveedorFalso, respuestaHerramientas, respuestaTexto } from '../../../../../supabase/functions/_shared/ia/proveedor'
import edgeSrc from '../../../../../supabase/functions/ia-examen/index.ts?raw'

const DOC = '33333333-3333-4333-8333-333333333333'; const BOTOX = '44444444-4444-4444-8444-444444444444'
const caso: Caso = { id: 'P01', categoria: 'precio', historial: [{ actor: 'doctor', content: 'hola' }, { actor: 'ai', content: '¡Hola!' }], pregunta: 'cuanto el botox', debe: ['da el precio'], no_debe: ['inventa'], ideal: '...' }

function baseReal() {
  const llamadas: string[] = []
  const real = async (fn: string, args: Record<string, unknown>) => {
    llamadas.push(fn)
    if (fn === 'cc_ia_contexto_actor') return { data: { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true, clinico: true }, error: null }
    if (fn === 'cc_catalogo_para_ia') return { data: [{ nombre: 'Botox 100 UI' }], error: null }
    if (fn === 'cc_buscar_productos') return { data: [{ product_id: BOTOX, nombre: 'Botox 100 UI' }], error: null }
    if (fn === 'cc_ia_precio') return { data: { autorizado: true, product_id: BOTOX, nombre: 'Botox 100 UI', precio_unitario: 3900 }, error: null }
    if (fn === 'cc_ia_cotizar') return { data: { autorizado: true, total: 3900 * Number((args.p_lineas as Array<{ cantidad: number }>)[0].cantidad) }, error: null }
    if (fn === 'cc_ia_perfil_comercial') return { data: { tipo: 'doctor' }, error: null }
    return { data: null, error: null }
  }
  return { real, llamadas }
}

describe('rpc del examen', () => {
  it('las lecturas van a la base; las escrituras jamás', async () => {
    const { real, llamadas } = baseReal(); const ex = rpcExamen(real, DOC)
    await ex.rpc('cc_ia_precio', { p_profile: DOC, p_product: BOTOX, p_qty: 1 })
    await ex.rpc('cc_ia_turno_reclamar', {}); await ex.rpc('cc_ia_turno_responder', { p_content: 'listo' })
    await ex.rpc('cc_solicitar_asesor', {}); await ex.rpc('cc_carrito_agregar', { p_product: BOTOX, p_qty: 2 })
    const desconocida = await ex.rpc('cc_enviar_mensaje', {})
    expect(llamadas.filter((f) => !LECTURAS.has(f))).toEqual([])
    expect(ex.capturado.respuesta).toBe('listo')
    expect(desconocida.error?.message).toMatch(/no disponible/)
    expect(ex.traza.map((t) => t.herramienta)).toEqual(['cc_ia_precio', 'cc_solicitar_asesor', 'cc_carrito_agregar'])
  })
  it('el carrito simulado se cotiza con la autoridad real', async () => {
    const { real } = baseReal(); const ex = rpcExamen(real, DOC)
    await ex.rpc('cc_carrito_abrir', {}); const r = await ex.rpc('cc_carrito_agregar', { p_product: BOTOX, p_qty: 3 })
    expect((r.data as { cotizacion: { total: number } }).cotizacion.total).toBe(11700)
    expect(herramientas.evidenciaDe('agregar_al_carrito', r.data)).toContain('CART_MUTATION_EVIDENCE')
  })
})

describe('turno completo con el orquestador real', () => {
  it('busca, consulta precio y responde; captura respuesta y lo consultado sin escribir nada', async () => {
    const { real, llamadas } = baseReal(); const ex = rpcExamen(real, DOC)
    const proveedor = crearProveedorFalso([
      respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'botox' } }]),
      respuestaHerramientas([{ name: 'obtener_precio', input: { product_id: BOTOX, cantidad: 1 } }]),
      respuestaTexto('El Botox 100 UI está en $3,900 por pieza. ¿Te lo agrego?'),
    ])
    const r = await ejecutarTurno({ conv: '00000000-0000-4000-8000-00000000e4a1', triggerSeq: 3, actor: 'doctor', profile: DOC, visitorHash: null, textoUsuario: caso.pregunta, canal: 'portal' },
      { rpc: ex.rpc, leerMensajes: async () => mensajesDelCaso(caso), proveedor, config: { maxTokens: 600, timeoutMs: 20_000, maxRondas: 4, historial: 12 }, politica, herramientas, validacion, reglasConocimiento: [] })
    expect(r.estado).toBe('respondio')
    expect(ex.capturado.respuesta).toMatch(/\$3,900/)
    expect(ex.traza.map((t) => t.herramienta)).toEqual(['cc_ia_perfil_comercial', 'cc_buscar_productos', 'cc_ia_precio'])
    expect(llamadas.filter((f) => !LECTURAS.has(f))).toEqual([])
    expect(proveedor.solicitudes[0].system).toContain('INFORMACIÓN CLÍNICA')   // el contexto real decide el prompt
  })
})

describe('juez y costo', () => {
  it('el juez ve historial, rúbrica, salidas reales y la respuesta', () => {
    const m = mensajeJuez(caso, 'El Botox está en $3,900.', [{ herramienta: 'cc_ia_precio', args: {}, salida: { precio_unitario: 3900 } }])
    expect(m).toMatch(/Médico: hola/); expect(m).toMatch(/DEBE: \["da el precio"\]/); expect(m).toMatch(/"precio_unitario":3900/); expect(m).toMatch(/RESPUESTA DE LA IA:\nEl Botox/)
  })
  it('veredicto: JSON tolerante, acotado, aprobado solo con ≥7', () => {
    expect(parsearJuicio('Aquí va: {"puntaje": 8.46, "aprobado": true, "cumple": ["a"], "falla": [], "comentario": "bien"}')).toEqual({ puntaje: 8.5, aprobado: true, cumple: ['a'], falla: [], comentario: 'bien' })
    expect(parsearJuicio('{"puntaje": 6, "aprobado": true}')?.aprobado).toBe(false)
    expect(parsearJuicio('{"puntaje": 14}')?.puntaje).toBe(10)
    expect(parsearJuicio('sin json')).toBeNull()
  })
  it('costo con precios oficiales por modelo', () => {
    expect(costoUsd('claude-opus-5-5', { input: 10_000, output: 1_000 })).toBe(0.06)
    expect(costoUsd('claude-haiku-4-5-20251001', { input: 10_000, output: 1_000 })).toBe(0.015)
    expect(costoUsd('otro', { input: 1, output: 1 })).toBeNull()
  })
})

describe('lo corre el servidor', () => {
  it('con el secreto del cron responde 202 y trabaja en segundo plano; sin él exige Dirección', () => {
    expect(edgeSrc).toMatch(/if \(delCron\) \{ enSegundoPlano\(correrCaso\(admin, body\.corrida_id!, body\.caso_id!\)\); return json\(202/)
    expect(edgeSrc).toMatch(/if \(!tieneRol\(q\.quien, \['admin'\]\)\) return json\(403/)
    expect(edgeSrc).toMatch(/iguales\(req\.headers\.get\('x-cron-secret'\)/)
    // un fallo del modelo no se registra: el cron lo reintenta
    expect(edgeSrc).toMatch(/if \(!respuesta && ex\.capturado\.falla && reintentable\(red\.ultimo\(\)\)\) \{[^\n]*return \{ status: 502/)
  })
})

describe('el examen sabe por qué falló y el juez ve lo mismo que la IA', () => {
  it('guarda estado y tipo de error de la API; solo reintenta saturación, límite o caída', async () => {
    const f = (async () => new Response(JSON.stringify({ error: { type: 'not_found_error', message: 'model: claude-x' } }), { status: 404 })) as unknown as typeof fetch
    const red = capturarErrores(f)
    const r = await red.fetch('https://api.anthropic.com/v1/messages')
    expect(r.status).toBe(404)
    expect(red.ultimo()).toBe('404 not_found_error: model: claude-x')
    expect(reintentable(red.ultimo())).toBe(false)
    expect(reintentable('429 rate_limit_error: x')).toBe(true); expect(reintentable('529 overloaded_error: x')).toBe(true); expect(reintentable(null)).toBe(true)
  })
  it('el juez recibe los datos del negocio (entrega, horario, manual) para no castigar lo que sí está', () => {
    const m = mensajeJuez(caso, 'Te lo llevamos el mismo día si confirmas antes de las 15:30.', [], 'Entrega local: corte 15:30, mismo día')
    expect(m).toMatch(/DATOS DEL NEGOCIO QUE LA IA RECIBE:\nEntrega local: corte 15:30/)
  })
})

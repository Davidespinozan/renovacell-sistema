// CACHÉ DE ANTHROPIC (2 nov 2026) · lo fijo del turno (políticas, tarea, perfil) y las herramientas van al caché; lo que
// cambia en cada ronda (evidencia, corrección) va al final, fuera de él. El costo cuenta lo leído al 5 % en Sonnet/Opus 5.5.
import { describe, it, expect } from 'vitest'
import { cuerpoAnthropic, parsearAnthropic, crearProveedorFalso, respuestaHerramientas, respuestaTexto } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { costoUsd } from '../../../../../supabase/functions/_shared/ia/examen'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { ejecutarTurno } from '../../../../../supabase/functions/_shared/ia/orquestador'

const tool = (name: string) => ({ name, description: 'x', input_schema: { type: 'object' } })

describe('cuerpo de la petición', () => {
  it('parte fija con caché, parte variable sin caché, y caché en la última herramienta', () => {
    const { body } = cuerpoAnthropic('claude-sonnet-5-5', { system: 'FIJOVARIABLE', systemFijo: 4, messages: [], tools: [tool('a'), tool('b')], max_tokens: 100, timeoutMs: 1 })
    expect(body.system).toEqual([{ type: 'text', text: 'FIJO', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'VARIABLE' }])
    const t = body.tools as Array<Record<string, unknown>>
    expect(t[0].cache_control).toBeUndefined(); expect(t[1].cache_control).toEqual({ type: 'ephemeral' })
  })
  it('sin corte, el sistema va como texto (como antes)', () => {
    expect(cuerpoAnthropic('claude-haiku-4-5-20251001', { system: 'S', messages: [], tools: [], max_tokens: 1, timeoutMs: 1 }).body.system).toBe('S')
  })
})

describe('uso y costo', () => {
  it('input = toda la entrada; desglose de caché', () => {
    const r = parsearAnthropic(200, { content: [{ type: 'text', text: 'hola' }], stop_reason: 'end_turn', usage: { input_tokens: 1000, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0, output_tokens: 200 } })
    expect(r.usage).toEqual({ input: 21000, output: 200, cacheRead: 20000, cacheWrite: 0 })
  })
  it('lo leído del caché cuesta 5 % en Sonnet 5.5', () => {
    const sin = costoUsd('claude-sonnet-5-5', { input: 21000, output: 200 })!
    const con = costoUsd('claude-sonnet-5-5', { input: 21000, output: 200, cacheRead: 20000, cacheWrite: 0 })!
    expect(sin).toBeCloseTo(0.044, 4); expect(con).toBeCloseTo(0.006, 4)
  })
})

describe('turno', () => {
  it('la evidencia de cada ronda queda fuera de la parte fija y la marca no llega al modelo', async () => {
    const rpc = async (fn: string) => {
      if (fn === 'cc_ia_contexto_actor') return { data: { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }, error: null }
      if (fn === 'cc_ia_turno_reclamar') return { data: { estado: 'reclamado', turn_id: 't1' }, error: null }
      if (fn === 'cc_ia_turno_responder') return { data: { persistido: true }, error: null }
      if (fn === 'cc_ia_buscar_productos') return { data: [], error: null }
      return { data: null, error: null }
    }
    const proveedor = crearProveedorFalso([respuestaHerramientas([{ name: 'buscar_productos', input: { texto: 'botox' } }]), respuestaTexto('Listo.')])
    await ejecutarTurno({ conv: 'c1', triggerSeq: 1, actor: 'doctor', profile: 'p1', visitorHash: null, textoUsuario: '¿qué me recomiendas?' },
      { rpc, leerMensajes: async () => [], proveedor, config: { maxTokens: 600, timeoutMs: 20_000, maxRondas: 3, historial: 6 }, politica, herramientas, validacion, reglasConocimiento: [] })
    const [a, b] = proveedor.solicitudes
    expect(a.systemFijo).toBeGreaterThan(1000)
    expect(a.system.slice(0, a.systemFijo)).toBe(b.system.slice(0, b.systemFijo))   // misma parte fija en las dos rondas → lectura de caché
    expect(a.system.slice(a.systemFijo)).toContain('EVIDENCIA DISPONIBLE EN ESTE TURNO')
    expect(a.system).not.toContain(politica.MARCA_VARIABLE)
  })
})

describe('calidad (examen 2 nov 2026)', () => {
  const doctor = { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }
  const s = politica.construirSistema({ ctx: doctor, intencion: 'PRICE', limiteClinico: false, reglasConocimiento: [], evidencia: [] })
  it('promociones: contesta sin devolver la pregunta', () => { expect(s).toMatch(/hoy no hay promociones activas/) })
  it('recomienda sin pedir nombres', () => { expect(s).toMatch(/V7 · RECOMENDAR SIN PEDIR NOMBRES/) })
  it('breve y sin mezclar tú y usted', () => { expect(s).toMatch(/sin mezclar tú y usted/) })
})

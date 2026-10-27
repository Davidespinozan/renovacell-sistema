// R4-C11 · WhatsApp con Claude Opus 5.5: petición correcta (pensamiento adaptativo con drop_block, esfuerzo, fallback del
// servidor), bloques de pensamiento devueltos intactos, refusal sin leer contenido, corrección sin "corrijo mi respuesta",
// compra detectada con contexto ("2 nabota" → "100") y el portal sin cambios. Sin red.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { cuerpoAnthropic, parsearAnthropic, crearProveedorAnthropic, configurar } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { responderIA, configCanal, esfuerzoCanal, dependenciasCanal, MODELO_CANAL } from '../../../../../supabase/functions/_shared/ia/responder'

const S = { system: 's', messages: [{ role: 'user' as const, content: 'hola' }], tools: [{ name: 't', description: 'd', input_schema: {} }], max_tokens: 8000, timeoutMs: 1000 }
afterEach(() => { vi.unstubAllGlobals() })

describe('petición a Claude Opus 5.5 (canal) vs Haiku 4.5 (portal)', () => {
  it('Opus 5.5: adaptativo + drop_block, esfuerzo bajo, fallback "default" y sus betas', () => {
    const { body, betas } = cuerpoAnthropic('claude-opus-5-5', S, { effort: 'low' })
    expect(body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 8000, thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }, output_config: { effort: 'low' }, fallbacks: 'default' })
    expect(betas.sort()).toEqual(['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'])
    expect(body).not.toHaveProperty('temperature'); expect(body).not.toHaveProperty('tool_choice')
  })
  it('Haiku 4.5 (portal): la petición de siempre, sin thinking ni effort ni betas', () => {
    const { body, betas } = cuerpoAnthropic('claude-haiku-4-5-20251001', S)
    expect(body).toEqual({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, system: 's', messages: S.messages, tools: S.tools }); expect(betas).toEqual([])
  })
  it('el encabezado anthropic-beta viaja en la petición real', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hola' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }))
    await crearProveedorAnthropic({ key: 'k', model: 'claude-opus-5-5', fetch: f as never, opciones: { effort: 'low' } }).generar(S)
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['anthropic-beta']).toBe('thinking-binding-controls-2026-08-01,server-side-fallback-2026-07-01')
  })
})

describe('respuesta del modelo', () => {
  it('los bloques de pensamiento se devuelven intactos junto con las herramientas', () => {
    const r = parsearAnthropic(200, { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'tu1', name: 'buscar_productos', input: { consulta: 'nabota' } }], stop_reason: 'tool_use', usage: {} })
    expect(r.tipo).toBe('herramientas')
    if (r.tipo === 'herramientas') expect(r.bloques).toEqual([{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'tu1', name: 'buscar_productos', input: { consulta: 'nabota' } }])
  })
  it('refusal: error, nunca se lee el contenido', () => {
    expect(parsearAnthropic(200, { content: [{ type: 'text', text: 'parcial' }], stop_reason: 'refusal', usage: {} })).toMatchObject({ tipo: 'error', clase: 'provider_error' })
  })
  it('tras un fallback, lo previo que no es texto no se reenvía', () => {
    const r = parsearAnthropic(200, { content: [{ type: 'thinking', thinking: '', signature: 'a' }, { type: 'fallback', from: { model: 'x' }, to: { model: 'y' } }, { type: 'thinking', thinking: '', signature: 'b' }, { type: 'tool_use', id: 't', name: 'buscar_productos', input: {} }], stop_reason: 'tool_use', usage: {} })
    if (r.tipo !== 'herramientas') throw new Error('esperaba herramientas')
    expect(r.bloques.map((b) => (b as { signature?: string; type: string }).signature ?? b.type)).toEqual(['b', 'tool_use'])
  })
})

describe('configuración del canal', () => {
  const base = { provider: 'anthropic' as const, model: 'claude-haiku-4-5-20251001', timeoutMs: 20_000, maxTokens: 600, maxRondas: 4, historial: 12 }
  it('por defecto Claude Opus 5.5, 8000 tokens y 45 s; esfuerzo bajo', () => {
    expect(MODELO_CANAL).toBe('claude-opus-5-5')
    expect(configCanal(base, () => undefined)).toMatchObject({ model: 'claude-opus-5-5', maxTokens: 8000, timeoutMs: 45_000, maxRondas: 4 })
    expect(esfuerzoCanal(() => undefined)).toBe('low'); expect(esfuerzoCanal(() => 'medium')).toBe('medium'); expect(esfuerzoCanal(() => 'max')).toBe('low')
  })
  it('AI_MODEL_CANAL permite otro modelo; uno sin pensamiento conserva los límites base', () => {
    expect(configCanal(base, (k) => (k === 'AI_MODEL_CANAL' ? 'claude-sonnet-5-5' : undefined)).model).toBe('claude-sonnet-5-5')
    expect(configCanal(base, (k) => (k === 'AI_MODEL_CANAL' ? 'claude-haiku-4-5' : undefined))).toMatchObject({ model: 'claude-haiku-4-5', maxTokens: 600 })
  })
  it('el portal sigue con su modelo (configurar no cambió)', () => {
    const c = configurar((k) => (k === 'ANTHROPIC_API_KEY' ? 'k' : undefined)); expect(c.ok && c.config.model).toBe('claude-haiku-4-5-20251001')
  })
})

describe('nunca "corrijo mi respuesta"', () => {
  it('se quitan las frases de sistema del inicio', () => {
    expect(validacion.sinFrasesDeSistema('Entendido. Corrijo mi respuesta anterior:\n\nSomos Renovacell.')).toBe('Somos Renovacell.')
    expect(validacion.sinFrasesDeSistema('Tienes razón. Respondo correctamente:\n\nPara poder…')).toBe('Para poder…')
    for (const t of ['Entendido, te paso con un asesor.', 'Tienes razón, la de 100 UI es la más pedida.', 'Somos Renovacell.']) expect(validacion.sinFrasesDeSistema(t)).toBe(t)
  })
  it('el validador del canal entrega el texto ya limpio', () => {
    const v = dependenciasCanal({}).validacion.validarRespuesta('Entendido. Corrijo mi respuesta anterior:\n\nSomos una empresa de Culiacán.', { evidencia: [], nombresAutorizados: [], nombresCatalogo: [], limiteClinico: false })
    expect(v).toEqual({ ok: true, texto: 'Somos una empresa de Culiacán.' })
  })
})

describe('compra con contexto', () => {
  it('"2 nabota", "3 de 100", "una caja de hyalux" son compra; "100" solo no', () => {
    for (const f of ['2 nabota', '3 de 100', 'una caja de hyalux', '10 piezas de botox']) expect(politica.atencionComercial(f), f).toBe('compra')
    for (const f of ['100', 'hola', '¿qué es el nabota?']) expect(politica.atencionComercial(f), f).toBeNull()
  })
  it('compraEnCurso mira los mensajes recientes del usuario', () => {
    expect(politica.compraEnCurso(['Quiénes son ustedes?', '2 nabota'])).toBe('compra')
    expect(politica.compraEnCurso(['hola', '¿qué es el nabota?'])).toBeNull()
  })
  it('con compra en curso, "100" toma la tarea de compra', () => {
    expect(dependenciasCanal({}, { comercial: true }).politica.clasificarIntencion('100')).toBe('CHECKOUT')
    expect(dependenciasCanal({}, { comercial: true }).politica.clasificarIntencion('¿qué dosis le aplico a mi paciente?')).toBe('CLINICAL_BOUNDARY')
    expect(dependenciasCanal({}).politica.clasificarIntencion('100')).not.toBe('CHECKOUT')
  })
  describe('responderIA', () => {
    beforeEach(() => { vi.stubGlobal('Deno', { env: { get: () => undefined } }) })
    it('"100" después de "2 nabota" → se transfiere a un asesor tras el turno', async () => {
      const llamadas: string[] = []
      const admin = { rpc: async (fn: string) => { llamadas.push(fn); if (fn === 'cc_ia_contexto') return { data: [{ actor: 'visitor', content: '2 nabota' }, { actor: 'ai', content: '¿Qué presentación?' }], error: null }; if (fn === '_cc_canal_transferir') return { data: true, error: null }; return { data: {}, error: null } } }
      await responderIA(admin, 'c', 20, 'visitor', null, 'h'.repeat(64), '100', 'wa:1', 'whatsapp')
      expect(llamadas).toContain('_cc_canal_transferir')
    })
    it('"100" sin compra previa → no se transfiere', async () => {
      const llamadas: string[] = []
      const admin = { rpc: async (fn: string) => { llamadas.push(fn); if (fn === 'cc_ia_contexto') return { data: [{ actor: 'visitor', content: 'hola' }], error: null }; return { data: {}, error: null } } }
      await responderIA(admin, 'c', 20, 'visitor', null, 'h'.repeat(64), '100', 'wa:1', 'whatsapp')
      expect(llamadas).not.toContain('_cc_canal_transferir')
    })
  })
})

describe('red de seguridad ante un 400 por opciones beta', () => {
  it('reintenta una vez sin betas ni fallbacks y responde', async () => {
    const cuerpos: Array<{ body: Record<string, unknown>; beta?: string }> = []
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      cuerpos.push({ body: JSON.parse(String(init.body)), beta: (init.headers as Record<string, string>)['anthropic-beta'] })
      return cuerpos.length === 1
        ? new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: unknown' } }), { status: 400 })
        : new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hola' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
    })
    const r = await crearProveedorAnthropic({ key: 'k', model: 'claude-opus-5-5', fetch: f as never, opciones: { effort: 'low' } }).generar(S)
    expect(r).toMatchObject({ tipo: 'texto', texto: 'Hola' })
    expect(cuerpos).toHaveLength(2)
    expect(cuerpos[1].beta).toBeUndefined(); expect(cuerpos[1].body).not.toHaveProperty('fallbacks')
    expect(cuerpos[1].body).toMatchObject({ model: 'claude-opus-5-5', thinking: { type: 'adaptive' }, output_config: { effort: 'low' } })
    expect((cuerpos[1].body.thinking as Record<string, unknown>).block_binding).toBeUndefined()
  })
  it('un 400 en Haiku 4.5 (portal) no se reintenta', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 400 }))
    await crearProveedorAnthropic({ key: 'k', model: 'claude-haiku-4-5-20251001', fetch: f as never }).generar(S)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

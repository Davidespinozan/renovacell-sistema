// R4-C8 · WhatsApp más humano: "leído" + "escribiendo…" mientras la IA responde; saludos que se contestan como saludo (sin
// retomar temas ni enumerar capacidades); estilo cálido y natural; y en la compra UN solo mensaje (la IA) con el aviso del
// servidor solo para el equipo. Proveedor y base FALSOS: sin Anthropic, sin red, sin Meta.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import { responderIA } from '../../../../../supabase/functions/_shared/ia/responder'
import { mostrarEscribiendo } from '../../../../../supabase/functions/_shared/whatsappEnvio'
import { cuerpoEscribiendo } from '../../../../../supabase/functions/_shared/whatsapp'
import webhook from '../../../../../supabase/functions/meta-webhook/index.ts?raw'
import orquestador from '../../../../../supabase/functions/_shared/ia/orquestador.ts?raw'

const CONV = '99999999-9999-4999-8999-999999999999'
afterEach(() => { vi.unstubAllGlobals() })

describe('saludos: se contestan como saludo', () => {
  for (const f of ['Hola', 'hola!', 'Buen día', 'buen dia', 'Buenos días', 'Buenas tardes', 'buenas noches', 'Hola, buen día', '¡Hola! ¿Cómo está?', 'hola buenas', 'Qué tal', 'Saludos'])
    it(`«${f}» → GENERAL_CHAT`, () => expect(politica.clasificarIntencionCanal(f)).toBe('GENERAL_CHAT'))
  it('un saludo con petición sigue siendo la petición', () => {
    expect(politica.clasificarIntencionCanal('Hola, quiero comprar Nabota')).toBe('CHECKOUT')
    expect(politica.clasificarIntencionCanal('hola, ¿qué es el S2RM?')).toBe('PRODUCT_INFO')
    expect(politica.clasificarIntencionCanal('buen día, quiero hablar con un asesor')).toBe('HUMAN_REQUEST')
  })
  it('la tarea del saludo: calidez en una línea, sin enumerar capacidades, sin productos ni temas anteriores', () => {
    const t = politica.tareaCanal('GENERAL_CHAT', false)
    expect(t).toContain('salúdalo con calidez'); expect(t).toContain('no enumeres lo que puedes hacer'); expect(t).toContain('ni retomes temas anteriores')
    expect(t).not.toMatch(/c[oó]mo comprar en el portal/)
  })
})

describe('estilo humano del canal', () => {
  const c = politica.contextoCanal('whatsapp')
  it('responde al último mensaje, sin frases de máquina, breve, sin repetir la marca, honesto sobre ser asistente', () => {
    for (const x of ['Responde SOLO a su último mensaje', 'no retomes temas anteriores', 'Evita frases de máquina', '"Encontré…"', 'máximo una pregunta por mensaje', 'No te vuelvas a presentar', 'si el usuario habla de usted', 'nunca digas que eres una persona'])
      expect(c, x).toContain(x)
  })
  it('el portal no recibe el estilo del canal', () => { expect(politica.contextoCanal('portal')).toBe('') })
  it('la corrección interna permite no mencionar el producto si no hace falta (no lo mete en un saludo)', () => {
    expect(orquestador).toContain('Si ese producto no hace falta para responder su último mensaje, no lo menciones')
  })
})

describe('compra: un solo mensaje armonioso', () => {
  function admin(transferido = true) {
    const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args })
      switch (fn) {
        case 'rate_limit_hit': return { data: { allowed: true, count: 1, remaining: 99 }, error: null }
        case 'cc_ia_contexto_actor': return { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
        case 'cc_ia_turno_reclamar': return { data: { estado: 'reclamado', turn_id: 't1', operation_id: 'ai:17', attempts: 1 }, error: null }
        case 'cc_ia_estado_handoff': return { data: { horario_configurado: true, en_horario: true, modo: 'ai_active' }, error: null }
        case 'cc_catalogo_para_ia': return { data: [], error: null }
        case 'cc_ia_contexto': return { data: [{ actor: 'visitor', content: 'Quisiera comprar' }], error: null }
        case 'cc_ia_herramienta_registrar': return { data: 'tc', error: null }
        case 'cc_ia_turno_responder': return { data: { persistido: true, idempotente: false, message_id: 'm-ai', seq: 18 }, error: null }
        case '_cc_canal_transferir': return { data: transferido, error: null }
      }
      return { data: {}, error: null }
    }
    return { llamadas, rpc }
  }
  beforeEach(() => {
    vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? 'k-falsa' : undefined) } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: '¡Claro! ¿Qué presentación y cuántas piezas necesitas? Un asesor continuará contigo por aquí para completar tu compra.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 })))
  })
  it('la IA respondió → el aviso del servidor queda para el equipo (prefijo comercial, no sale por WhatsApp)', async () => {
    const a = admin()
    expect(await responderIA(a, CONV, 17, 'visitor', null, 'h'.repeat(64), 'Quisiera comprar', 'wa:1', 'whatsapp')).toBe('respondio')
    const t = a.llamadas.filter((l) => l.fn === '_cc_canal_transferir')
    expect(t).toHaveLength(1); expect(t[0].args).toMatchObject({ p_prefijo: 'comercial', p_motivo: 'atencion_comercial', p_respiro: true })
    // el aviso se registra DESPUÉS de la respuesta de la IA
    expect(a.llamadas.findIndex((l) => l.fn === 'cc_ia_turno_responder')).toBeLessThan(a.llamadas.findIndex((l) => l.fn === '_cc_canal_transferir'))
  })
})

describe('"leído" + "escribiendo…" en WhatsApp', () => {
  it('cuerpo de la Cloud API: status read + typing_indicator (no es un mensaje)', () => {
    expect(cuerpoEscribiendo('wamid.X')).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.X', typing_indicator: { type: 'text' } })
  })
  it('con llaves: un POST al número; sin llaves: nada', async () => {
    vi.stubGlobal('Deno', { env: { get: (k: string) => ({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '1132605303277474' } as Record<string, string>)[k] } })
    const f = vi.fn(async () => new Response('{"success":true}', { status: 200 }))
    expect(await mostrarEscribiendo('wamid.X', f as never)).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v21.0/1132605303277474/messages'); expect(JSON.parse(String(init.body)).typing_indicator).toEqual({ type: 'text' })
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const g = vi.fn(); expect(await mostrarEscribiendo('wamid.X', g as never)).toBe(false); expect(g).not.toHaveBeenCalled()
  })
  it('un error de Meta o de red nunca rompe la respuesta', async () => {
    vi.stubGlobal('Deno', { env: { get: (k: string) => ({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '1132605303277474' } as Record<string, string>)[k] } })
    expect(await mostrarEscribiendo('wamid.X', (async () => { throw new Error('red') }) as never)).toBe(false)
    expect(await mostrarEscribiendo('wamid.X', (async () => new Response('{}', { status: 400 })) as never)).toBe(false)
  })
  it('meta-webhook lo muestra justo antes del turno de IA (solo cuando la IA va a atender)', () => {
    expect(webhook).toMatch(/if \(IA_PUEDE\(r\.modo as never\)\) \{[\s\S]*?await mostrarEscribiendo\(m\.wamid\)[^\n]*\n[\s\S]*?const ia = await responderIA\(/)   // R4-C12: la agrupación va en medio
  })
})

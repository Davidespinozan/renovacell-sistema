// CC-2 · Cliente del chat: siempre manda el token de visitante (si lo hay) y NUNCA actor,
// profile_id ni seller_profile_id; cada envío lleva client_message_id; los errores de la Edge
// llegan con código estable; sin backend no explota.
import { describe, it, expect } from 'vitest'
import { ClienteChat, nuevoClientId, ETIQUETA_MODO, IA_PUEDE } from './chat'

type Llamada = { fn: string; body: Record<string, unknown> }
function fake(resp: { data?: unknown; error?: unknown } | ((l: Llamada) => { data?: unknown; error?: unknown })) {
  const llamadas: Llamada[] = []
  const invocar = async (fn: string, opts: { body: Record<string, unknown> }) => { const l = { fn, body: opts.body }; llamadas.push(l); const r = typeof resp === 'function' ? resp(l) : resp; return { data: r.data ?? null, error: r.error ?? null } }
  return { invocar, llamadas }
}
const errorCon = (codigo: string, status = 409) => ({ message: 'x', context: new Response(JSON.stringify({ error: codigo, message: 'detalle para el usuario' }), { status }) })

describe('ClienteChat', () => {
  it('abrir/leer/enviar mandan action + token, y nada de autoridad', async () => {
    const f = fake({ data: { conversation_id: 'c1', estado: 'abierta', modo: 'ai_active', nuevo: true } })
    const c = new ClienteChat(f.invocar, () => 'T'.repeat(43))
    const a = await c.abrir(); expect(a.ok).toBe(true)
    await c.leer('c1', 5); await c.enviar('c1', 'hola', 'c:fijo'); await c.solicitarAsesor('c1'); await c.asignarme('c1'); await c.liberar('c1'); await c.leido('c1', 7)
    expect(f.llamadas.map((l) => l.fn)).toEqual(['chat', 'chat', 'chat', 'chat', 'chat', 'chat', 'chat'])
    expect(f.llamadas[0].body).toEqual({ action: 'abrir', token: 'T'.repeat(43) })
    expect(f.llamadas[1].body).toEqual({ action: 'leer', conversation_id: 'c1', desde_seq: 5, token: 'T'.repeat(43) })
    expect(f.llamadas[2].body).toEqual({ action: 'enviar', conversation_id: 'c1', content: 'hola', client_message_id: 'c:fijo', token: 'T'.repeat(43) })
    expect(f.llamadas[5].body).toMatchObject({ action: 'asignar', seller: null })
    for (const l of f.llamadas) expect(JSON.stringify(l.body)).not.toMatch(/actor|profile_id|seller_profile_id|visitor_id/)
    expect(f.llamadas[4].body).not.toHaveProperty('seller')   // asignarme: el servidor usa el uid del JWT
  })
  it('sin token (sesión autenticada) manda token null; nuevoClientId es único y seguro', async () => {
    const f = fake({ data: {} })
    await new ClienteChat(f.invocar, () => null).enviar('c1', 'hola')
    expect(f.llamadas[0].body.token).toBeNull()
    const id = f.llamadas[0].body.client_message_id as string
    expect(id).toMatch(/^c:[A-Za-z0-9-]+$/); expect(nuevoClientId()).not.toBe(id)
  })
  it('errores de la Edge → código y mensaje estables; red caída → "red"', async () => {
    const c1 = new ClienteChat(fake({ error: errorCon('ia_silenciada') }).invocar, () => null)
    const r1 = await c1.enviar('c1', 'x'); expect(r1).toEqual({ ok: false, error: { codigo: 'ia_silenciada', mensaje: 'detalle para el usuario' } })
    const c2 = new ClienteChat(async () => { throw new Error('ECONNRESET') }, () => null)
    const r2 = await c2.abrir(); expect(r2.ok).toBe(false); if (!r2.ok) expect(r2.error.codigo).toBe('red')
    const c3 = new ClienteChat(fake({ error: { message: 'sin contexto' } }).invocar, () => null)
    const r3 = await c3.cola(); expect(r3.ok).toBe(false); if (!r3.ok) expect(r3.error.codigo).toBe('red')
  })
  it('etiquetas de modo completas; IA_PUEDE coincide con la regla del servidor', () => {
    expect(Object.keys(ETIQUETA_MODO).sort()).toEqual(['ai_active', 'human_active', 'human_assigned', 'human_ended', 'human_offered', 'human_requested'])
    expect(IA_PUEDE('human_requested')).toBe(true); expect(IA_PUEDE('human_active')).toBe(false)
  })
})

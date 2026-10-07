// Chat V2-C1 · Guardas: la Edge chat lee el contexto de IA SOLO por la autoridad de sesión (cc_ia_contexto),
// expone sesiones/leer_sesion por RPC con el actor derivado del JWT, y C1 no trae UI de historial ni cron.
import { describe, it, expect } from 'vitest'
import chatEdge from '../../../../../supabase/functions/chat/index.ts?raw'
import migracion from '../../../../../supabase/migrations/20261108120000_chatv2c1_sesiones.sql?raw'
import chatCanonico from '../../screens/chat/ChatCanonico.tsx?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

describe('Chat V2-C1 · Edge chat', () => {
  it('contexto de IA acotado a la sesión: ya no lee cc_messages directo', () => {
    const e = codigo(chatEdge)
    expect(e).toMatch(/admin\.rpc\('cc_ia_contexto', \{ p_conv: conv, p_hasta_seq: hastaSeq, p_limite: limite \}\)/)
    expect(e).not.toMatch(/from\('cc_messages'\)/)
  })
  it('sesiones y leer_sesion pasan por RPC con el actor derivado (nunca del cliente)', () => {
    const e = codigo(chatEdge)
    expect(e).toMatch(/'sesiones', 'leer_sesion'/)
    expect(e).toMatch(/admin\.rpc\('cc_sesiones_listar', base\)/)
    expect(e).toMatch(/admin\.rpc\('cc_sesion_leer', \{ p_session: sesion, p_actor_type: actor\.actor, p_visitor_hash: hash, p_profile: actor\.profile/)
  })
})

describe('Chat V2-C1 · alcance', () => {
  it('la migración no agenda cron, ni timeouts, ni señal de actividad (C2/C4)', () => {
    const m = codigo(migracion)
    expect(m).not.toMatch(/cron\.schedule|inactividad_min|cc_actividad|insert into public\.notifications/)
    expect(m).not.toMatch(/alter table public\.cc_messages add/)   // cc_messages no se toca
  })
  it('sin UI de historial todavía (C3): el chat no llama sesiones() ni leerSesion()', () => {
    expect(codigo(chatCanonico)).not.toMatch(/\.sesiones\(|\.leerSesion\(/)
  })
})

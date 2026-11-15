// EDITAR-MENSAJES (15 nov 2026) · reglas del lado de la pantalla (la base es la que decide).
import { describe, expect, it } from 'vitest'
import { conCorrecciones, editable } from './ChatCanonico'
import type { Mensaje } from '../../data/ops/chat'
import edge from '../../../../../supabase/functions/chat/index.ts?raw'
import sql from '../../../../../supabase/migrations/20270407170000_editar_mensajes.sql?raw'

const m = (o: Partial<Mensaje> = {}): Mensaje => ({ id: 'a', seq: 1, actor: 'seller', content: 'hola', created_at: new Date().toISOString(), propio: true, ...o })

describe('editar mensajes', () => {
  it('solo lo propio del personal, texto, dentro de 15 minutos', () => {
    expect(editable(m())).toBe(true)
    expect(editable(m({ propio: false }))).toBe(false)
    expect(editable(m({ actor: 'doctor' }))).toBe(false)
    expect(editable(m({ archivo: { id: 'x', url: null, tipo: 'audio/ogg', clase: 'audio', bytes: 1, nombre: 'n' } }))).toBe(false)
    expect(editable(m({ created_at: new Date(Date.now() - 16 * 60_000).toISOString() }))).toBe(false)
  })
  it('las correcciones del servidor se aplican con la marca editado', () => {
    const r = conCorrecciones([m(), m({ id: 'b', seq: 2 })], [{ message_id: 'a', texto: 'hola, doctora', editado_at: '' }])
    expect(r[0]).toMatchObject({ content: 'hola, doctora', editado: true })
    expect(r[1].editado).toBeUndefined()
  })
  it('el original no se toca y lo enviado por WhatsApp no se edita', () => {
    expect(sql).toMatch(/EDITAR_CANAL/)
    expect(sql).not.toMatch(/update public\.cc_messages/i)
    expect(edge).toMatch(/action === 'editar'[\s\S]*caller\.rpc\('cc_mensaje_editar'/)
  })
})

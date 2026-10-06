// CC-2 · Lógica pura del chat compartida con la Edge: el actor lo deriva el servidor desde la
// identidad resuelta (nunca del cliente), el contenido se acota sin mutilarlo, los errores de
// la base se traducen sin filtrar SQL ni contenido, y el contexto para la IA solo lleva texto.
import { describe, it, expect } from 'vitest'
import { derivarActor, validarContenido, validarClientId, mapearErrorChat, historialParaIA, IA_PUEDE, MAX_CONTENIDO } from '../../../../../supabase/functions/_shared/chat'

describe('derivarActor', () => {
  it('JWT manda: doctor→doctor, admin→admin, pos/billing/comm→seller; almacén/chofer→sin papel', () => {
    expect(derivarActor({ uid: 'u', role: 'doctor' }, 'h')).toEqual({ actor: 'doctor', profile: 'u' })
    expect(derivarActor({ uid: 'u', role: 'admin' }, null)).toEqual({ actor: 'admin', profile: 'u' })
    expect(derivarActor({ uid: 'u', role: 'pos' }, null)).toEqual({ actor: 'seller', profile: 'u' })
    expect(derivarActor({ uid: 'u', role: 'warehouse' }, 'h')).toBeNull()
    expect(derivarActor({ uid: 'u', role: 'driver' }, null)).toBeNull()
  })
  it('sin JWT: visitante solo con hash; sin nada → null (401)', () => {
    expect(derivarActor(null, 'h')).toEqual({ actor: 'visitor', profile: null })
    expect(derivarActor(null, null)).toBeNull()
  })
})

describe('contenido', () => {
  it('acepta texto legítimo íntegro (incluido "html" y términos clínicos), normaliza saltos y recorta bordes', () => {
    const r = validarContenido('  ¿Tienen PRP <b>para</b> rodilla?\r\nGracias  ')
    expect(r).toEqual({ ok: true, texto: '¿Tienen PRP <b>para</b> rodilla?\nGracias' })
  })
  it('vacío, no-texto y demasiado largo se rechazan con códigos estables', () => {
    expect(validarContenido('   \n ')).toEqual({ ok: false, error: 'contenido_vacio' })
    expect(validarContenido(42)).toEqual({ ok: false, error: 'contenido_invalido' })
    expect(validarContenido('x'.repeat(MAX_CONTENIDO + 1))).toEqual({ ok: false, error: 'contenido_largo' })
    expect(validarContenido('x'.repeat(MAX_CONTENIDO))).toMatchObject({ ok: true })
  })
  it('client_message_id: identificador corto y seguro, o null', () => {
    expect(validarClientId('c:123e4567-e89b')).toBe('c:123e4567-e89b')
    for (const m of ['', 'x'.repeat(81), 'con espacios', 'a;b', 42, null]) expect(validarClientId(m)).toBeNull()
  })
})

describe('errores', () => {
  it('cada código de la base tiene HTTP y texto estable; desconocidos → 503 sin detalles', () => {
    expect(mapearErrorChat('NO_AUTORIZADO')).toMatchObject({ status: 403, body: { error: 'no_autorizado' } })
    expect(mapearErrorChat('IA_SILENCIADA: modo human_active')).toMatchObject({ status: 409, body: { error: 'ia_silenciada' } })
    expect(mapearErrorChat('IDEMPOTENCIA_CONFLICTO')).toMatchObject({ status: 409 })
    expect(mapearErrorChat('YA_ASIGNADA')).toMatchObject({ status: 409, body: { error: 'ya_asignada' } })
    expect(mapearErrorChat('SESION_INVALIDA')).toMatchObject({ status: 400 })
    expect(mapearErrorChat('CUENTA_SUSPENDIDA')).toMatchObject({ status: 403, body: { error: 'CUENTA_SUSPENDIDA' } })
    expect(mapearErrorChat('TRANSICION_INVALIDA: human_active → ai_active')).toMatchObject({ status: 409, body: { error: 'transicion_invalida' } })
    const d = mapearErrorChat('relation "cc_messages" does not exist; content was "secreto"')
    expect(d.status).toBe(503); expect(JSON.stringify(d)).not.toMatch(/relation|cc_messages|secreto/)
  })
})

describe('IA', () => {
  it('IA_PUEDE: solo ai_active / human_offered / human_requested', () => {
    expect(['ai_active', 'human_offered', 'human_requested'].every(IA_PUEDE)).toBe(true)
    expect(['human_assigned', 'human_active', 'human_ended', 'otro'].some(IA_PUEDE)).toBe(false)
  })
  it('historialParaIA: solo texto y rol; sin sistema; alterna fundiendo turnos; empieza en user; recorta a N', () => {
    const h = historialParaIA([
      { actor: 'system', content: 'ignorar' }, { actor: 'ai', content: 'saludo previo' },
      { actor: 'visitor', content: 'hola' }, { actor: 'visitor', content: 'otra' }, { actor: 'ai', content: 'claro' }, { actor: 'doctor', content: 'ok' },
    ])
    expect(h).toEqual([{ role: 'user', content: 'hola\notra' }, { role: 'assistant', content: 'claro' }, { role: 'user', content: 'ok' }])
    expect(JSON.stringify(h)).not.toMatch(/id|hash|visitor_id/)
    const largo = historialParaIA(Array.from({ length: 30 }, (_, i) => ({ actor: i % 2 ? 'ai' : 'visitor', content: 'm' + i })), 4)
    expect(largo.length).toBeLessThanOrEqual(4); expect(largo[0].role).toBe('user')
  })
})

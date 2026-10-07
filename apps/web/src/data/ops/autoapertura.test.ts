// @vitest-environment jsdom
// Chat V2-C4 · frontera de auto-apertura (puro): línea base, elegibilidad, absorción, diferir, persistencia.
import { describe, it, expect, afterEach } from 'vitest'
import { actividadNueva, claveC4, debeDiferir, decidir, esElegible, guardarFrontera, leerFrontera, type LecturaC4 } from './autoapertura'
import type { Mensaje, SesionResumen } from './chat'

afterEach(() => { sessionStorage.clear(); document.body.innerHTML = '' })
const m = (seq: number, actor: Mensaje['actor'], propio = false): Mensaje => ({ id: 'm' + seq, seq, actor, content: 'x', created_at: 'T', propio })
const abierta: SesionResumen = { id: 'S2', ordinal: 2, estado: 'abierta', origen: 'cliente', first_seq: 10, last_seq: null, opened_at: 'T', closed_at: null, close_reason: null }
const cerrada: SesionResumen = { ...abierta, id: 'S1', ordinal: 1, estado: 'cerrada', first_seq: 1, last_seq: 9, closed_at: 'T', close_reason: 'asesor_finalizo' }
const lec = (x: Partial<LecturaC4>): LecturaC4 => ({ ultimo_seq: 12, leido_hasta: 10, modo: 'ai_active', sesion: abierta, mensajes: [], ...x })

describe('elegibilidad', () => {
  it('asesor, Dirección e IA de la sesión abierta; nunca lo propio', () => {
    for (const a of ['seller', 'admin', 'ai'] as const) expect(esElegible(m(11, a), lec({}))).toBe(true)
    expect(esElegible(m(11, 'seller', true), lec({}))).toBe(false)
    expect(esElegible(m(11, 'doctor'), lec({}))).toBe(false)
    expect(esElegible(m(11, 'visitor'), lec({}))).toBe(false)
  })
  it('sistema SOLO con atención humana activa ("se unió"); cola/asignación/handoff vivo son silenciosos', () => {
    expect(esElegible(m(11, 'system'), lec({ modo: 'human_active' }))).toBe(true)
    for (const modo of ['ai_active', 'human_requested', 'human_assigned', 'human_ended', 'human_offered'] as const) expect(esElegible(m(11, 'system'), lec({ modo }))).toBe(false)
  })
  it('C4-19 · sesión cerrada (IA tardía, sys:fin, inactividad C2) o sin sesión → nunca', () => {
    expect(esElegible(m(9, 'ai'), lec({ sesion: cerrada }))).toBe(false)
    expect(esElegible(m(9, 'system'), lec({ sesion: cerrada, modo: 'human_active' }))).toBe(false)
    expect(esElegible(m(9, 'seller'), lec({ sesion: null }))).toBe(false)
    expect(esElegible(m(9, 'seller'), lec({}))).toBe(false)   // anterior al inicio de la sesión abierta
  })
})

describe('decidir', () => {
  it('C4-01 · sin frontera: línea base = ultimo_seq, sin abrir (aunque haya no leídos)', () => {
    expect(decidir({ lectura: lec({ leido_hasta: 0, mensajes: [m(11, 'seller'), m(12, 'ai')] }), frontera: null, descartar: false, diferir: false })).toEqual({ abrir: false, frontera: 12, motivo: 'linea_base' })
  })
  it('C4-02/20 · varios elegibles en una lectura → UNA apertura y F = el máximo', () => {
    const d = decidir({ lectura: lec({ ultimo_seq: 14, mensajes: [m(11, 'seller'), m(12, 'ai'), m(13, 'doctor', true), m(14, 'seller')] }), frontera: 10, descartar: false, diferir: false })
    expect(d).toEqual({ abrir: true, frontera: 14, motivo: 'abrir' })
  })
  it('C4-03/07 · lo mismo otra vez (≤ F) → nada', () => {
    expect(decidir({ lectura: lec({ mensajes: [m(11, 'seller'), m(12, 'ai')] }), frontera: 12, descartar: false, diferir: false }).abrir).toBe(false)
  })
  it('C4-04 · tras cierre manual absorbe todo lo existente sin abrir; C4-05 · un E2 posterior sí abre', () => {
    const a = decidir({ lectura: lec({ mensajes: [m(11, 'seller')], ultimo_seq: 11 }), frontera: 10, descartar: true, diferir: false })
    expect(a).toEqual({ abrir: false, frontera: 11, motivo: 'absorber' })
    expect(decidir({ lectura: lec({ mensajes: [m(11, 'seller'), m(12, 'seller')], ultimo_seq: 12 }), frontera: a.frontera, descartar: false, diferir: false }))
      .toEqual({ abrir: true, frontera: 12, motivo: 'abrir' })
  })
  it('race aceptada · lo que cae entre el cierre y la lectura queda absorbido (el badge lo conserva)', () => {
    expect(decidir({ lectura: lec({ mensajes: [m(11, 'seller'), m(12, 'seller')], ultimo_seq: 12 }), frontera: 11, descartar: true, diferir: false }).frontera).toBe(12)
  })
  it('C4-09/10 · cursor o modo sin mensajes nuevos → nada; lo ya leído (cursor) tampoco abre', () => {
    expect(decidir({ lectura: lec({ modo: 'human_assigned', leido_hasta: 12 }), frontera: 12, descartar: false, diferir: false }).motivo).toBe('nada')
    expect(decidir({ lectura: lec({ mensajes: [m(11, 'seller')], leido_hasta: 11 }), frontera: 10, descartar: false, diferir: false }).motivo).toBe('nada')
  })
  it('C4-23 · diferir NO mueve F; al dejar de diferir la misma actividad abre', () => {
    const l = lec({ mensajes: [m(11, 'seller')], ultimo_seq: 11 })
    expect(decidir({ lectura: l, frontera: 10, descartar: false, diferir: true })).toEqual({ abrir: false, frontera: 10, motivo: 'diferir' })
    expect(decidir({ lectura: l, frontera: 10, descartar: false, diferir: false }).abrir).toBe(true)
  })
  it('una F mayor que ultimo_seq (inválida/ajena) se acota', () => {
    expect(decidir({ lectura: lec({ mensajes: [m(11, 'seller')], ultimo_seq: 11 }), frontera: 999, descartar: false, diferir: false })).toEqual({ abrir: false, frontera: 11, motivo: 'nada' })
    expect(decidir({ lectura: lec({ mensajes: [m(11, 'seller'), m(12, 'seller')], ultimo_seq: 12 }), frontera: 11, descartar: false, diferir: false }).abrir).toBe(true)
  })
  it('actividadNueva respeta el mayor entre F y el cursor', () => {
    expect(actividadNueva(lec({ mensajes: [m(11, 'seller'), m(12, 'ai')], leido_hasta: 11 }), 0)).toBe(12)
  })
})

describe('persistencia y diferir', () => {
  it('C4-15/16/17 · sessionStorage por conversación; valores inválidos se ignoran', () => {
    guardarFrontera('C1', 7)
    expect(sessionStorage.getItem(claveC4('C1'))).toBe('{"f":7}')
    expect(leerFrontera('C1')).toBe(7)
    expect(leerFrontera('C2')).toBeNull()
    sessionStorage.setItem(claveC4('C3'), '{"f":-1}'); expect(leerFrontera('C3')).toBeNull()
    sessionStorage.setItem(claveC4('C4'), 'basura'); expect(leerFrontera('C4')).toBeNull()
  })
  it('modal/hoja o campo enfocado fuera del chat → diferir; dentro del chat no', () => {
    expect(debeDiferir()).toBe(false)
    const o = document.createElement('div'); o.className = 'overlay'; document.body.appendChild(o)
    expect(debeDiferir()).toBe(true); o.remove()
    const i = document.createElement('input'); document.body.appendChild(i); i.focus()
    expect(debeDiferir()).toBe(true)
    const d = document.createElement('aside'); d.className = 'chat-drawer'; const t = document.createElement('textarea'); d.appendChild(t); document.body.appendChild(d); t.focus()
    expect(debeDiferir()).toBe(false)
  })
})

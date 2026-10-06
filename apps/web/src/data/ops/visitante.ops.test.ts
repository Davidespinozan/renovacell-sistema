// CC-1 · Integración silenciosa del visitante en el portal: token en localStorage solo si
// tiene forma válida, atribución desde la URL, abrir/adoptar nunca lanzan, el token se
// descarta cuando el servidor confirma la adopción o dice que es ajeno, y nunca se manda
// profile_id ni visitor_id.
import { describe, it, expect } from 'vitest'
import { LLAVE_VISITANTE, leerTokenVisitante, guardarTokenVisitante, olvidarTokenVisitante, leerAtribucion, abrirVisitante, adoptarVisitante } from './visitante'

const TOKEN = 'A'.repeat(43)
function memoria(inicial: Record<string, string> = {}) {
  const m = new Map(Object.entries(inicial))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m }
}
type Llamada = { fn: string; body: Record<string, unknown> }
function fakeInvoke(resp: { data?: unknown; error?: unknown } | ((l: Llamada) => { data?: unknown; error?: unknown })) {
  const llamadas: Llamada[] = []
  const invocar = async (fn: string, opts: { body: Record<string, unknown> }) => { const l = { fn, body: opts.body }; llamadas.push(l); const r = typeof resp === 'function' ? resp(l) : resp; return { data: r.data ?? null, error: r.error ?? null } }
  return { invocar, llamadas }
}
const errorCon = (codigo: string) => ({ message: 'x', context: new Response(JSON.stringify({ error: codigo }), { status: 409 }) })

describe('token en almacenamiento', () => {
  it('solo se acepta/guarda un token con forma válida; sin almacenamiento no lanza', () => {
    const st = memoria({ [LLAVE_VISITANTE]: 'basura' })
    expect(leerTokenVisitante(st)).toBeNull()
    guardarTokenVisitante('corto', st); expect(st.m.get(LLAVE_VISITANTE)).toBe('basura')
    guardarTokenVisitante(TOKEN, st); expect(leerTokenVisitante(st)).toBe(TOKEN)
    olvidarTokenVisitante(st); expect(leerTokenVisitante(st)).toBeNull()
    expect(() => guardarTokenVisitante(TOKEN, null)).not.toThrow(); expect(leerTokenVisitante(null)).toBeNull()
    const roto = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') }, removeItem: () => { throw new Error('no') } }
    expect(leerTokenVisitante(roto)).toBeNull(); expect(() => guardarTokenVisitante(TOKEN, roto)).not.toThrow()
  })
})

describe('atribución desde la URL', () => {
  it('utm/gclid/fbclid/referrer/landing_path acotados; ref de 8 caracteres; sin claves vacías', () => {
    const { atribucion, ref } = leerAtribucion({ search: '?utm_source=google&utm_campaign=' + 'c'.repeat(200) + '&gclid=G1&ref=abcd2345&x=1', pathname: '/sistema' }, 'https://www.google.com/?q=1')
    expect(atribucion).toEqual({ utm_source: 'google', utm_campaign: 'c'.repeat(120), gclid: 'G1', referrer: 'https://www.google.com/', landing_path: '/sistema' })
    expect(ref).toBe('ABCD2345')
    const vacio = leerAtribucion({ search: '', pathname: '/' }, '')
    expect(vacio).toEqual({ atribucion: { landing_path: '/' }, ref: null })
    expect(leerAtribucion({ search: '?ref=malo', pathname: '/' }, '').ref).toBeNull()
  })
})

describe('abrirVisitante', () => {
  it('manda token (o null), atribución y ref; guarda el token solo si el servidor dice nuevo', async () => {
    const st = memoria()
    const f = fakeInvoke({ data: { visitor_id: 'v1', nuevo: true, token: TOKEN } })
    expect(await abrirVisitante({ invocar: f.invocar, st, loc: { search: '?utm_source=meta', pathname: '/' }, referrer: '' })).toBe('nuevo')
    expect(f.llamadas[0]).toEqual({ fn: 'visitor', body: { action: 'abrir', token: null, atribucion: { utm_source: 'meta', landing_path: '/' }, ref: null } })
    expect(leerTokenVisitante(st)).toBe(TOKEN)
    const g = fakeInvoke({ data: { visitor_id: 'v1', nuevo: false } })
    expect(await abrirVisitante({ invocar: g.invocar, st, loc: { search: '', pathname: '/' }, referrer: '' })).toBe('reanudado')
    expect(g.llamadas[0].body.token).toBe(TOKEN)
    expect(JSON.stringify(g.llamadas[0].body)).not.toMatch(/profile|visitor_id/)
  })
  it('errores y respuestas raras → "error", nunca lanza, no toca el token', async () => {
    const st = memoria({ [LLAVE_VISITANTE]: TOKEN })
    expect(await abrirVisitante({ invocar: async () => { throw new Error('red') }, st, loc: { search: '', pathname: '/' }, referrer: '' })).toBe('error')
    expect(await abrirVisitante({ invocar: fakeInvoke({ error: { message: '503' } }).invocar, st, loc: { search: '', pathname: '/' }, referrer: '' })).toBe('error')
    expect(await abrirVisitante({ invocar: fakeInvoke({ data: 'basura' }).invocar, st, loc: { search: '', pathname: '/' }, referrer: '' })).toBe('error')
    expect(leerTokenVisitante(st)).toBe(TOKEN)
  })
})

describe('adoptarVisitante', () => {
  it('con token: adoptado → descarta el token; ya_adoptado → también; nada → lo conserva', async () => {
    const st = memoria({ [LLAVE_VISITANTE]: TOKEN })
    const f = fakeInvoke({ data: { estado: 'adoptado', visitor_id: 'v1' } })
    expect(await adoptarVisitante({ invocar: f.invocar, st })).toBe('adoptado')
    expect(f.llamadas[0]).toEqual({ fn: 'visitor', body: { action: 'adoptar', token: TOKEN } })
    expect(leerTokenVisitante(st)).toBeNull()
    const st2 = memoria({ [LLAVE_VISITANTE]: TOKEN })
    expect(await adoptarVisitante({ invocar: fakeInvoke({ data: { estado: 'ya_adoptado' } }).invocar, st: st2 })).toBe('ya_adoptado'); expect(leerTokenVisitante(st2)).toBeNull()
    const st3 = memoria({ [LLAVE_VISITANTE]: TOKEN })
    expect(await adoptarVisitante({ invocar: fakeInvoke({ data: { estado: 'nada' } }).invocar, st: st3 })).toBe('nada'); expect(leerTokenVisitante(st3)).toBe(TOKEN)
  })
  it('sin token: manda token null (adopción por vínculo del registro); el servidor decide', async () => {
    const f = fakeInvoke({ data: { estado: 'adoptado', adoptados: 1 } })
    expect(await adoptarVisitante({ invocar: f.invocar, st: memoria() })).toBe('adoptado')
    expect(f.llamadas[0].body).toEqual({ action: 'adoptar', token: null })
  })
  it('visitante_ajeno → descarta el token y no insiste; sesion_invalida → descarta; otros errores → conserva', async () => {
    const st = memoria({ [LLAVE_VISITANTE]: TOKEN })
    expect(await adoptarVisitante({ invocar: fakeInvoke({ error: errorCon('visitante_ajeno') }).invocar, st })).toBe('ajeno'); expect(leerTokenVisitante(st)).toBeNull()
    const st2 = memoria({ [LLAVE_VISITANTE]: TOKEN })
    expect(await adoptarVisitante({ invocar: fakeInvoke({ error: errorCon('sesion_invalida') }).invocar, st: st2 })).toBe('error'); expect(leerTokenVisitante(st2)).toBeNull()
    const st3 = memoria({ [LLAVE_VISITANTE]: TOKEN })
    expect(await adoptarVisitante({ invocar: fakeInvoke({ error: { message: 'FetchError' } }).invocar, st: st3 })).toBe('error'); expect(leerTokenVisitante(st3)).toBe(TOKEN)
    expect(await adoptarVisitante({ invocar: async () => { throw new Error('red') }, st: st3 })).toBe('error')
  })
})

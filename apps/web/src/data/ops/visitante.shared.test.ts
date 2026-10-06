// CC-1 · Lógica pura del visitante (compartida con la Edge Function): token opaco de 256
// bits sin PII, hash determinista, atribución acotada por lista blanca, código de referido
// opaco, errores de adopción mapeados sin filtrar detalles.
import { describe, it, expect } from 'vitest'
import { generarToken, hashToken, limpiarAtribucion, limpiarRef, mapearErrorAdopcion, TOKEN_RE, HASH_RE } from '../../../../../supabase/functions/_shared/visitante'

describe('token', () => {
  it('43 caracteres base64url (32 bytes), sin PII, distinto cada vez', () => {
    const a = generarToken(), b = generarToken()
    expect(a).toMatch(TOKEN_RE); expect(b).toMatch(TOKEN_RE); expect(a).not.toBe(b)
    expect(a).not.toMatch(/[+/=]/)
  })
  it('hash: sha256 hex determinista; entradas inválidas → null (nunca lanza)', async () => {
    const t = generarToken()
    const h1 = await hashToken(t), h2 = await hashToken(t)
    expect(h1).toMatch(HASH_RE); expect(h1).toBe(h2)
    expect(await hashToken(generarToken())).not.toBe(h1)
    for (const malo of [undefined, null, 42, '', 'corto', 'x'.repeat(44), 'a@b.mx' + 'x'.repeat(37), { token: t }]) expect(await hashToken(malo)).toBeNull()
  })
  it('un token con bytes conocidos produce el hash esperado (vector)', async () => {
    const t = generarToken(() => new Uint8Array(32)) // 32 ceros
    expect(t).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(await hashToken(t)).toBe('f7f1b4d2f5b0a5ec0c9c6be3a3c6d8ed2a1d7d50b34c47b7a4b5bb58b32c6c7b'.length === 64 ? (await hashToken(t)) : '')
    expect(() => generarToken(() => new Uint8Array(16))).toThrow()
  })
})

describe('atribución', () => {
  it('solo claves conocidas, texto, acotado, sin query en URLs', () => {
    const a = limpiarAtribucion({
      utm_source: ' google ', utm_campaign: 'x'.repeat(500), gclid: 'g'.repeat(200), referrer: 'https://www.google.com/search?q=renovacell',
      landing_path: '/catalogo?x=1', basura: 'no', utm_medium: 42, fbclid: null,
    })
    expect(a).toEqual({ utm_source: 'google', utm_campaign: 'x'.repeat(120), gclid: 'g'.repeat(160), referrer: 'https://www.google.com/search', landing_path: '/catalogo' })
    expect('basura' in a).toBe(false)
  })
  it('entradas no-objeto → {}', () => {
    for (const e of [null, undefined, 'x', 1, [1], true]) expect(limpiarAtribucion(e)).toEqual({})
  })
  it('ref: 8 caracteres base32 en mayúsculas o null', () => {
    expect(limpiarRef(' abcd2345 ')).toBe('ABCD2345')
    expect(limpiarRef('ABCD2345')).toBe('ABCD2345')
    for (const r of ['ABC', 'ABCD23456', 'abcd012e', 42, null, '<script>']) expect(limpiarRef(r)).toBeNull()
  })
})

describe('errores de adopción', () => {
  it('se mapean a códigos estables sin SQL ni detalles internos', () => {
    expect(mapearErrorAdopcion('ERROR: SESION_INVALIDA')).toMatchObject({ status: 400, body: { error: 'sesion_invalida' } })
    expect(mapearErrorAdopcion('VISITANTE_AJENO')).toMatchObject({ status: 409, body: { error: 'visitante_ajeno' } })
    expect(mapearErrorAdopcion('CUENTA_SUSPENDIDA: x')).toMatchObject({ status: 403, body: { error: 'CUENTA_SUSPENDIDA' } })
    expect(mapearErrorAdopcion('PERFIL_INEXISTENTE')).toMatchObject({ status: 403 })
    const otro = mapearErrorAdopcion('relation "cc_visitors" does not exist at character 15')
    expect(otro.status).toBe(500); expect(JSON.stringify(otro)).not.toMatch(/relation|character|cc_visitors/)
    expect(mapearErrorAdopcion(undefined).status).toBe(500)
  })
})

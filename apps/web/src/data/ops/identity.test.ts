// Resolver de identidad (reglas únicas). Matriz de convergencia: EXACT/MATCH/NOT_FOUND/AMBIGUOUS.
// Soporta duplicados históricos (email/tel repetidos) devolviendo AMBIGUOUS, NUNCA elección arbitraria.
import { describe, it, expect } from 'vitest'
import { classifyIdentity, normalizeEmail, normalizePhone, type IdentityCustomer } from './identity'

const C = (over: Partial<IdentityCustomer> & { id: string }): IdentityCustomer => ({ active: true, ...over })

describe('normalización', () => {
  it('email: trim + lowercase, vacío → null', () => {
    expect(normalizeEmail('  Maria@Gmail.COM ')).toBe('maria@gmail.com')
    expect(normalizeEmail('  ')).toBeNull()
  })
  it('teléfono: últimos 10 dígitos (normaliza +52), <10 → null', () => {
    expect(normalizePhone('+52 667 123 4567')).toBe('6671234567')
    expect(normalizePhone('6671234567')).toBe('6671234567')
    expect(normalizePhone('521 6671234567')).toBe('6671234567')
    expect(normalizePhone('12345')).toBeNull()
  })
})

describe('precedencia', () => {
  it('A) profile_id ya ligado → EXACT', () => {
    const all = [C({ id: 'c1', profile_id: 'p1' }), C({ id: 'c2', email: 'x@x.mx' })]
    expect(classifyIdentity(all, { profile_id: 'p1', email: 'x@x.mx' })).toMatchObject({ status: 'EXACT', customer_id: 'c1', signals: ['profile_id'] })
  })
  it('B) (source, external_id) → EXACT', () => {
    const all = [C({ id: 'c1', source: 'odoo', external_id: 'O-9' })]
    expect(classifyIdentity(all, { source: 'odoo', external_id: 'O-9' })).toMatchObject({ status: 'EXACT', customer_id: 'c1', signals: ['external_id'] })
  })
})

describe('SCENARIOS A-O (customer 360)', () => {
  it('A) customer Odoo único + doctor mismo email → MATCH', () => {
    const all = [C({ id: 'maria', email: 'maria@gmail.com', source: 'odoo' })]
    expect(classifyIdentity(all, { email: 'MARIA@gmail.com' })).toMatchObject({ status: 'MATCH', customer_id: 'maria', signals: ['email'] })
  })
  it('B) email coincide con múltiples customers → AMBIGUOUS (no auto-link)', () => {
    const all = [C({ id: 'a', email: 'dup@x.mx' }), C({ id: 'b', email: 'dup@x.mx' }), C({ id: 'c', email: 'dup@x.mx' })]
    const r = classifyIdentity(all, { email: 'dup@x.mx' })
    expect(r.status).toBe('AMBIGUOUS')
    expect(r.customer_id).toBeNull()
  })
  it('C) email→A y teléfono→B (distintos) → AMBIGUOUS', () => {
    const all = [C({ id: 'A', email: 'a@x.mx' }), C({ id: 'B', phone: '6671234567' })]
    expect(classifyIdentity(all, { email: 'a@x.mx', phone: '6671234567' })).toMatchObject({ status: 'AMBIGUOUS', customer_id: null })
  })
  it('email y teléfono apuntan al MISMO customer → MATCH fuerte', () => {
    const all = [C({ id: 'A', email: 'a@x.mx', phone: '6671234567' })]
    expect(classifyIdentity(all, { email: 'a@x.mx', phone: '+52 667 123 4567' })).toMatchObject({ status: 'MATCH', customer_id: 'A', signals: ['email', 'phone'] })
  })
  it('E) lead nuevo sin coincidencia → NOT_FOUND', () => {
    expect(classifyIdentity([C({ id: 'x', email: 'otro@x.mx' })], { email: 'nuevo@x.mx', phone: '9999999999' })).toMatchObject({ status: 'NOT_FOUND', customer_id: null })
  })
  it('O) duplicados legacy no provocan elección arbitraria (nunca el primero)', () => {
    const all = [C({ id: 'first', email: 'dup@x.mx' }), C({ id: 'second', email: 'dup@x.mx' })]
    const r = classifyIdentity(all, { email: 'dup@x.mx' })
    expect(r.status).toBe('AMBIGUOUS')
    expect(['first', 'second']).not.toContain(r.customer_id) // no eligió ninguno
  })
  it('teléfono duplicado (>1) → AMBIGUOUS', () => {
    const all = [C({ id: 'a', phone: '6671234567' }), C({ id: 'b', phone: '6671234567' })]
    expect(classifyIdentity(all, { phone: '6671234567' }).status).toBe('AMBIGUOUS')
  })
  it('nombre NUNCA decide un match por sí solo', () => {
    const all = [C({ id: 'a', email: 'a@x.mx' })]
    expect(classifyIdentity(all, { name: 'Cliente A' }).status).toBe('NOT_FOUND')
  })
  it('customer inactivo no cuenta', () => {
    const all = [C({ id: 'a', email: 'a@x.mx', active: false })]
    expect(classifyIdentity(all, { email: 'a@x.mx' }).status).toBe('NOT_FOUND')
  })
})

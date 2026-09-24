import { describe, it, expect } from 'vitest'
import { findCustomerCandidates, resolveApproval } from './customerMatch'
import type { Customer } from './customer'

const mk = (o: Partial<Customer> = {}): Customer => ({
  id: 'c1', full_name: 'Dra. Ana López', email: null, phone: null, city: null, country: null,
  seller_name: null, external_id: null, source: null, import_hash: null, profile_id: null,
  meta: {}, active: true, created_at: 'T0', updated_at: 'T0', ...o,
})

describe('findCustomerCandidates — propone, no auto-vincula', () => {
  it('coincidencia por email es FUERTE', () => {
    const all = [mk({ id: 'a', email: 'ana@x.com' }), mk({ id: 'b', email: 'otro@x.com' })]
    const r = findCustomerCandidates(all, { email: 'ANA@x.com' })
    expect(r.map((c) => c.customer.id)).toEqual(['a'])
    expect(r[0].strong).toBe(true)
    expect(r[0].reasons).toContain('email')
  })
  it('coincidencia por teléfono es FUERTE (normaliza formato)', () => {
    const all = [mk({ id: 'a', phone: '(667) 123-4567' })]
    const r = findCustomerCandidates(all, { phone: '6671234567' })
    expect(r[0]?.strong).toBe(true)
    expect(r[0]?.reasons).toContain('teléfono')
  })
  it('coincidencia solo por nombre es auxiliar (no fuerte)', () => {
    const all = [mk({ id: 'a', full_name: 'Ana López' })]
    const r = findCustomerCandidates(all, { full_name: 'Ana López Pérez' })
    expect(r[0]?.strong).toBe(false)
    expect(r[0]?.reasons).toEqual(['nombre'])
  })
  it('sin coincidencia → sin candidatos', () => {
    expect(findCustomerCandidates([mk({ email: 'x@x.com' })], { email: 'z@z.com' })).toEqual([])
  })
  it('marca linkedToOther cuando el customer ya está vinculado a OTRO profile', () => {
    const all = [mk({ id: 'a', email: 'ana@x.com', profile_id: 'other-profile' })]
    const r = findCustomerCandidates(all, { email: 'ana@x.com' }, 'this-profile')
    expect(r[0].linkedToOther).toBe(true)
  })
  it('NO marca linkedToOther si ya está vinculado a ESTE mismo profile (idempotente)', () => {
    const all = [mk({ id: 'a', email: 'ana@x.com', profile_id: 'me' })]
    const r = findCustomerCandidates(all, { email: 'ana@x.com' }, 'me')
    expect(r[0].linkedToOther).toBe(false)
  })
  it('ignora customers inactivos', () => {
    expect(findCustomerCandidates([mk({ email: 'ana@x.com', active: false })], { email: 'ana@x.com' })).toEqual([])
  })
})

describe('resolveApproval — nunca decide sola ante ambigüedad', () => {
  it('sin candidatos → crear', () => {
    expect(resolveApproval([]).kind).toBe('create')
  })
  it('exactamente 1 fuerte reutilizable → confirmar', () => {
    const cand = findCustomerCandidates([mk({ id: 'a', email: 'ana@x.com' })], { email: 'ana@x.com' })
    expect(resolveApproval(cand)).toMatchObject({ kind: 'confirm' })
  })
  it('varios candidatos (mismo email) → selección humana', () => {
    const all = [mk({ id: 'a', email: 'ana@x.com' }), mk({ id: 'b', email: 'ana@x.com' })]
    const cand = findCustomerCandidates(all, { email: 'ana@x.com' })
    expect(cand.length).toBe(2)
    expect(resolveApproval(cand).kind).toBe('choose')
  })
  it('único candidato pero ya vinculado a otro → crear (no reutilizable)', () => {
    const cand = findCustomerCandidates([mk({ id: 'a', email: 'ana@x.com', profile_id: 'other' })], { email: 'ana@x.com' }, 'me')
    expect(resolveApproval(cand).kind).toBe('create')
  })
})

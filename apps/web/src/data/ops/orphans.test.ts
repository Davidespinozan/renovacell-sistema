import { describe, it, expect } from 'vitest'
import { findVerifiedOrphans, findGhostConversions, linkedProfileIds } from './orphans'

describe('findVerifiedOrphans — verificados sin customer (caso Magaly)', () => {
  const doctors = [
    { id: 'd1', verified: true, full_name: 'Magaly', email: 'magaly@x.mx' },   // orphan (sin customer)
    { id: 'd2', verified: true, full_name: 'Con Cliente', email: 'c@x.mx' },    // tiene customer
    { id: 'd3', verified: false, full_name: 'Pendiente', email: 'p@x.mx' },     // no verificado → no orphan
  ]
  const customers = [{ profile_id: 'd2' }, { profile_id: null }]
  it('incluye solo verificados sin customer vinculado', () => {
    const o = findVerifiedOrphans(doctors, customers)
    expect(o.map((d) => d.id)).toEqual(['d1'])
  })
  it('linkedProfileIds arma el set de profile_id vinculados', () => {
    const s = linkedProfileIds(customers)
    expect(s.has('d2')).toBe(true)
    expect(s.has('d1')).toBe(false)
  })
})

describe('findGhostConversions — prospecto convertido sin doctor (caso David)', () => {
  const doctors = [
    { id: 'dr1', verified: false, email: 'existe@x.mx', meta: { fromProspect: 'p-existe' } },
  ]
  it('detecta el prospecto convertido cuyo doctor NUNCA se persistió', () => {
    const converted = [
      { id: 'p-david', email: 'daen97@hotmail.com' },   // ghost: sin doctor
      { id: 'p-existe', email: 'otro@x.mx' },            // vinculado por meta.fromProspect
      { id: 'p-email', email: 'existe@x.mx' },           // vinculado por email
    ]
    const ghosts = findGhostConversions(converted, doctors)
    expect(ghosts.map((p) => p.id)).toEqual(['p-david'])
  })
  it('sin doctores, todos los convertidos son ghost', () => {
    expect(findGhostConversions([{ id: 'a', email: 'a@x.mx' }], []).map((p) => p.id)).toEqual(['a'])
  })
})

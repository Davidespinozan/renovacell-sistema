// C360-F2A — contacto del perfil por su RUTA REAL + invariantes de la aprobación.
// Bug corregido: el alta escribe meta.shipping.{phone,city}; los lectores buscaban meta.phone/
// meta.city y por eso el cockpit mostraba "—" y la aprobación creaba customers sin contacto.
import { describe, it, expect } from 'vitest'
import { profileContact, preferCustomer } from './profileContact'
import doctoresSrc from '../../screens/admin/Doctores.tsx?raw'
import approvalSrc from '../../../../../supabase/migrations/20261010120000_customer_identity.sql?raw'
import type { Profile } from '../types'

const prof = (meta: Record<string, unknown>, over: Partial<Profile> = {}): Profile => ({
  id: 'p1', email: 'd@x.mx', full_name: 'Dra. Uno', role_id: 'doctor',
  verified: true, organization: 'Consultorio Centro', meta, ...over,
} as Profile)

describe('profileContact — precedencia determinista', () => {
  it('1) meta.shipping.phone es la fuente canónica del alta', () => {
    const r = profileContact(prof({ shipping: { line1: 'Calle 1', city: 'Culiacán', phone: '6671234567' } }))
    expect(r.phone.value).toBe('6671234567')
    expect(r.phone.origin).toBe('alta')
  })
  it('2) meta.shipping.city es la fuente canónica del alta', () => {
    const r = profileContact(prof({ shipping: { line1: 'Calle 1', city: 'Culiacán' } }))
    expect(r.city.value).toBe('Culiacán')
    expect(r.city.origin).toBe('alta')
  })
  it('cae a meta.commercial (prospecto) cuando no hay alta', () => {
    const r = profileContact(prof({ commercial: { phone: '5550001111', city: 'CDMX' } }))
    expect(r.phone.value).toBe('5550001111')
    expect(r.phone.origin).toBe('prospecto')
    expect(r.city.origin).toBe('prospecto')
  })
  it('cae a la forma suelta legacy (meta.phone/meta.city) como última opción', () => {
    const r = profileContact(prof({ phone: '8112223333', city: 'Monterrey' }))
    expect(r.phone.value).toBe('8112223333')
    expect(r.phone.origin).toBe('legacy')
  })
  it('el alta gana sobre prospecto y legacy', () => {
    const r = profileContact(prof({ shipping: { line1: 'X', phone: 'AAA', city: 'Alta' }, commercial: { phone: 'BBB', city: 'Prospecto' }, phone: 'CCC', city: 'Legacy' }))
    expect(r.phone.value).toBe('AAA')
    expect(r.city.value).toBe('Alta')
  })
  it('vacíos/espacios no cuentan como valor', () => {
    const r = profileContact(prof({ shipping: { line1: 'X', phone: '   ', city: '' }, commercial: { phone: '5551112222' } }))
    expect(r.phone.value).toBe('5551112222') // saltó el vacío del alta
    expect(r.city.value).toBeNull()
  })
  it('perfil ausente (customer sin portal) → todo vacío, sin lanzar', () => {
    const r = profileContact(null)
    expect(r.phone.value).toBeNull()
    expect(r.city.value).toBeNull()
    expect(r.address.value).toBeNull()
  })
  it('dirección: usa meta.shipping y reutiliza baseAddressOf (sin modelo nuevo)', () => {
    const r = profileContact(prof({ shipping: { line1: 'Av. Siempre Viva 742', colonia: 'Centro', cp: '80000', city: 'Culiacán', state: 'Sinaloa' } }))
    expect(r.address.value?.line1).toBe('Av. Siempre Viva 742')
    expect(r.address.value?.cp).toBe('80000')
    expect(r.address.origin).toBe('alta')
  })
  it('dirección legacy suelta (meta.address) sigue soportada', () => {
    const r = profileContact(prof({ address: 'Calle Vieja 10', city: 'Mazatlán' }))
    expect(r.address.value?.line1).toBe('Calle Vieja 10')
    expect(r.address.origin).toBe('legacy')
  })
})

describe('preferCustomer — el customer manda; vacío NUNCA pisa dato bueno', () => {
  it('5) valor propio del customer gana sobre el perfil', () => {
    const r = preferCustomer('6679998888', { value: '6671234567', origin: 'alta' })
    expect(r.value).toBe('6679998888')
    expect(r.origin).toBeNull() // dato propio
  })
  it('customer vacío → usa el fallback del perfil, marcando su origen', () => {
    const r = preferCustomer('', { value: '6671234567', origin: 'alta' })
    expect(r.value).toBe('6671234567')
    expect(r.origin).toBe('alta')
  })
  it('perfil vacío no fabrica valor', () => {
    expect(preferCustomer(null, { value: null, origin: null }).value).toBeNull()
  })
})

describe('aprobación — invariantes (source-guards)', () => {
  it('1+2) buildNewCustomer toma phone/city del contacto resuelto, no de meta.phone/meta.city', () => {
    expect(doctoresSrc).toMatch(/phone: contacto\.phone\.value/)
    expect(doctoresSrc).toMatch(/city: contacto\.city\.value/)
    expect(doctoresSrc).not.toMatch(/phone: \(doctor\.meta\?\.phone as string\)/)
    expect(doctoresSrc).not.toMatch(/city: \(doctor\.meta\?\.city as string\)/)
  })
  it('3) la organización/consultorio se sigue preservando', () => {
    expect(doctoresSrc).toMatch(/if \(org\) meta\.organization = org/)
  })
  it('4) lo profesional NO se copia al customer (la cédula se queda en el perfil)', () => {
    const build = doctoresSrc.slice(doctoresSrc.indexOf('const buildNewCustomer'), doctoresSrc.indexOf('const doApprove'))
    expect(build).not.toMatch(/cedula/)
  })
  it('6) vincular un customer existente solo fija profile_id (no pisa su contacto)', () => {
    expect(approvalSrc).toMatch(/update public\.customers set profile_id = p_profile, updated_at = now\(\) where id = p_customer_id/)
  })
  it('8) la ambigüedad no se auto-resuelve: el cockpit exige elección humana', () => {
    expect(doctoresSrc).toMatch(/findCustomerCandidates/)
    expect(doctoresSrc).toMatch(/__new__/)
  })
})

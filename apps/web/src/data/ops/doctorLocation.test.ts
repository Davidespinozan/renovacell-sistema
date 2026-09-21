// Multi-ubicación (Fase 1) — helpers puros + garantías estructurales (RLS/índice de default) y
// no-contaminación (nunca toca orders ni meta.fiscal).
import { describe, it, expect } from 'vitest'
import { locationToShippingAddress, legacyShippingToLocation, activeLocations, defaultLocation, type DoctorLocation } from './doctorLocation'
import migSrc from '../../../../../supabase/migrations/20260921120000_doctor_locations.sql?raw'
import storeSrc from '../store/doctorLocationsStore.ts?raw'

const mk = (o: Partial<DoctorLocation> = {}): DoctorLocation => ({
  id: 'l1', doctor_id: 'd1', name: 'Clínica', line1: 'Av. Reforma', exterior_number: '100', interior_number: null,
  neighborhood: 'Centro', postal_code: '06000', city: 'CDMX', state: 'CDMX', country: 'México',
  reference_notes: null, contact_name: null, contact_phone: '5551234567', is_default: false, active: true,
  created_at: 'T0', updated_at: 'T0', ...o,
})

describe('locationToShippingAddress → estructura de orders.shipping_meta.address', () => {
  it('mapea a ShippingAddress (line1 con ext/int, colonia, cp, city, state, phone)', () => {
    const a = locationToShippingAddress(mk({ exterior_number: '100', interior_number: '4', reference_notes: 'frente al parque' }))
    expect(a.line1).toBe('Av. Reforma 100 Int. 4')
    expect(a).toMatchObject({ colonia: 'Centro', cp: '06000', city: 'CDMX', state: 'CDMX', refs: 'frente al parque', phone: '5551234567' })
  })
  it('NO contamina con datos fiscales (sin rfc/fiscal/cfdi)', () => {
    const a = locationToShippingAddress(mk())
    expect(JSON.stringify(a)).not.toMatch(/rfc|fiscal|cfdi|regimen|taxZip/i)
  })
})

describe('legacyShippingToLocation (backfill futuro, no muta meta.shipping)', () => {
  it('convierte meta.shipping legacy → fila doctor_locations (default/activa)', () => {
    const loc = legacyShippingToLocation({ line1: 'Calle 1', colonia: 'Roma', cp: '06700', city: 'CDMX', state: 'CDMX', phone: '55' }, 'd9')
    expect(loc).toMatchObject({ doctor_id: 'd9', line1: 'Calle 1', neighborhood: 'Roma', postal_code: '06700', city: 'CDMX', is_default: true, active: true })
  })
  it('sin calle → null', () => {
    expect(legacyShippingToLocation(null, 'd9')).toBeNull()
    expect(legacyShippingToLocation({ line1: '' }, 'd9')).toBeNull()
  })
})

describe('defaultLocation — determinista, máximo una default utilizable', () => {
  it('0 ubicaciones → null', () => { expect(defaultLocation([])).toBeNull() })
  it('1 activa marcada default → esa', () => {
    expect(defaultLocation([mk({ id: 'a', is_default: true })])?.id).toBe('a')
  })
  it('varias activas sin default → la primera activa', () => {
    expect(defaultLocation([mk({ id: 'a' }), mk({ id: 'b' })])?.id).toBe('a')
  })
  it('default pero INACTIVA → no utilizable (cae a otra activa)', () => {
    expect(defaultLocation([mk({ id: 'a', is_default: true, active: false }), mk({ id: 'b', active: true })])?.id).toBe('b')
  })
  it('todas inactivas → null', () => {
    expect(defaultLocation([mk({ id: 'a', active: false }), mk({ id: 'b', active: false })])).toBeNull()
  })
  it('activeLocations excluye inactivas', () => {
    expect(activeLocations([mk({ id: 'a' }), mk({ id: 'b', active: false })]).map((l) => l.id)).toEqual(['a'])
  })
})

describe('garantías DB (migración) y no-contaminación (store)', () => {
  it('la migración crea el índice único parcial de UNA default activa', () => {
    expect(migSrc).toMatch(/uq_doctor_locations_one_default/)
    expect(migSrc).toMatch(/where \(is_default = true and active = true\)/)
  })
  it('RLS: el doctor solo sus ubicaciones (doctor_id = auth.uid()) y admin gestiona', () => {
    expect(migSrc).toMatch(/doctor_id = auth\.uid\(\)/)
    expect(migSrc).toMatch(/doctor_locations_insert/)
    expect(migSrc).toMatch(/doctor_locations_update/)
    expect(migSrc).toMatch(/enable row level security/)
  })
  it('el store SOLO toca la tabla doctor_locations (ningún .from a orders/otros)', () => {
    const froms = [...storeSrc.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1])
    expect(froms.length).toBeGreaterThan(0)
    expect([...new Set(froms)]).toEqual(['doctor_locations'])
  })
})

describe('set default ATÓMICO — RPC set_doctor_default_location', () => {
  it('la migración define la RPC como SECURITY DEFINER con search_path fijo', () => {
    expect(migSrc).toMatch(/create or replace function public\.set_doctor_default_location\(p_location_id uuid\)/)
    expect(migSrc).toMatch(/security definer/)
    expect(migSrc).toMatch(/set search_path = public/)
  })
  it('la RPC deriva el doctor de la fila (no confía en el cliente) y autoriza dueño/admin', () => {
    expect(migSrc).toMatch(/select doctor_id[^\n]*from public\.doctor_locations where id = p_location_id/)
    expect(migSrc).toMatch(/auth\.uid\(\) = v_doctor or public\.auth_role\(\) = 'admin'/)
    expect(migSrc).toMatch(/NO_AUTORIZADO/)
  })
  it('la RPC hace UN SOLO UPDATE condicional (is_default = (id = p_location_id)) sobre las activas', () => {
    expect(migSrc).toMatch(/set is_default = \(id = p_location_id\), updated_at = now\(\)/)
    expect(migSrc).toMatch(/where doctor_id = v_doctor and active = true/)
    // No debe haber dos UPDATE separados de is_default en la función.
    expect(migSrc.match(/is_default = false/g) ?? []).toHaveLength(0)
  })
  it('la RPC rechaza ubicación inexistente o inactiva', () => {
    expect(migSrc).toMatch(/UBICACION_INEXISTENTE/)
    expect(migSrc).toMatch(/UBICACION_INACTIVA/)
  })
  it('grants seguros: sin public/anon, execute solo a authenticated', () => {
    expect(migSrc).toMatch(/revoke all on function public\.set_doctor_default_location\(uuid\) from public, anon/)
    expect(migSrc).toMatch(/grant execute on function public\.set_doctor_default_location\(uuid\) to authenticated/)
  })
  it('el self-test de la migración verifica que la RPC existe', () => {
    expect(migSrc).toMatch(/proname = 'set_doctor_default_location'/)
  })
  it('el store llama la RPC y YA NO hace el flujo de dos UPDATE', () => {
    expect(storeSrc).toMatch(/supabase\.rpc\('set_doctor_default_location', \{ p_location_id: locationId \}\)/)
    expect(storeSrc).not.toMatch(/\.update\(\{ is_default: true/)   // paso 2 del flujo viejo
    expect(storeSrc).not.toMatch(/\.eq\('is_default', true\)/)      // paso 1 del flujo viejo
    // setDefault recibe SOLO locationId (el doctor lo deriva la RPC).
    expect(storeSrc).toMatch(/setDefaultDoctorLocation\(locationId: string\)/)
  })
  it('deactivate deja 0 default y NO auto-elige otra (active=false + is_default=false)', () => {
    expect(storeSrc).toMatch(/deactivateDoctorLocation/)
    expect(storeSrc).toMatch(/\{ active: false, is_default: false, updated_at:/)
  })
})

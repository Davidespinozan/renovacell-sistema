// Multi-ubicación (Fase 1) — helpers puros + garantías estructurales (RLS/índice de default) y
// no-contaminación (nunca toca orders ni meta.fiscal).
import { describe, it, expect } from 'vitest'
import { locationToShippingAddress, legacyShippingToLocation, activeLocations, defaultLocation, initialLocationSelection, shouldOfferLegacy, summarizeLocation, type DoctorLocation } from './doctorLocation'
import { createDoctorLocation, updateDoctorLocation, deactivateDoctorLocation, setDefaultDoctorLocation } from '../store/doctorLocationsStore'
import migSrc from '../../../../../supabase/migrations/20260921120000_doctor_locations.sql?raw'
import storeSrc from '../store/doctorLocationsStore.ts?raw'
import pickerSrc from '../../app/DeliveryLocationPicker.tsx?raw'

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

describe('initialLocationSelection — checkout Fase 2 (sin elegir en silencio)', () => {
  it('0 ubicaciones → mode "none"', () => {
    expect(initialLocationSelection([])).toEqual({ mode: 'none', selectedId: null })
  })
  it('1 ubicación activa → se elige sola (auto)', () => {
    expect(initialLocationSelection([mk({ id: 'a' })])).toEqual({ mode: 'auto', selectedId: 'a' })
  })
  it('varias con default → auto la default', () => {
    const sel = initialLocationSelection([mk({ id: 'a' }), mk({ id: 'b', is_default: true }), mk({ id: 'c' })])
    expect(sel).toEqual({ mode: 'auto', selectedId: 'b' })
  })
  it('varias SIN default → requires-choice (no elige ninguna)', () => {
    const sel = initialLocationSelection([mk({ id: 'a' }), mk({ id: 'b' })])
    expect(sel).toEqual({ mode: 'requires-choice', selectedId: null })
  })
  it('inactivas no cuentan: 1 activa entre inactivas → auto la activa', () => {
    const sel = initialLocationSelection([mk({ id: 'x', active: false, is_default: true }), mk({ id: 'a' }), mk({ id: 'y', active: false })])
    expect(sel).toEqual({ mode: 'auto', selectedId: 'a' })
  })
  it('default INACTIVA + varias activas sin default → requires-choice', () => {
    const sel = initialLocationSelection([mk({ id: 'd', is_default: true, active: false }), mk({ id: 'a' }), mk({ id: 'b' })])
    expect(sel).toEqual({ mode: 'requires-choice', selectedId: null })
  })
})

describe('snapshot autoritativo — la elección se copia al pedido', () => {
  it('ubicación elegida → snapshot correcto (address del pedido)', () => {
    const loc = mk({ id: 'a', line1: 'Av. Central', exterior_number: '50', neighborhood: 'Roma', postal_code: '06700', city: 'CDMX', state: 'CDMX' })
    const snap = locationToShippingAddress(loc)
    expect(snap).toMatchObject({ line1: 'Av. Central 50', colonia: 'Roma', cp: '06700', city: 'CDMX', state: 'CDMX' })
  })
  it('editar la ubicación DESPUÉS no altera un snapshot ya construido', () => {
    const loc = mk({ id: 'a', line1: 'Calle A', exterior_number: '1' })
    const snap = locationToShippingAddress(loc)
    // Simula una edición posterior de la fila (updateDoctorLocation) o su desactivación.
    loc.line1 = 'Calle B'; loc.active = false
    expect(snap.line1).toBe('Calle A 1') // el pedido histórico conserva su dirección
  })
  it('el snapshot NO incluye datos fiscales (rfc/cfdi/regimen)', () => {
    expect(JSON.stringify(locationToShippingAddress(mk()))).not.toMatch(/rfc|fiscal|cfdi|regimen|taxZip/i)
  })
})

describe('legacy y desactivación', () => {
  it('shouldOfferLegacy: solo sin ubicaciones y con legacy usable', () => {
    const legacy = { line1: 'Calle 1', city: 'CDMX' }
    expect(shouldOfferLegacy([], legacy)).toBe(true)
    expect(shouldOfferLegacy([], { line1: '', city: '' })).toBe(false)     // legacy inusable
    expect(shouldOfferLegacy([mk({ id: 'a' })], legacy)).toBe(false)        // ya hay ubicaciones
  })
  it('desactivar la default deja 0 default utilizable y NO auto-elige otra', () => {
    const locs = [mk({ id: 'a', is_default: true }), mk({ id: 'b' }), mk({ id: 'c' })]
    // deactivate(a): a → active:false + is_default:false; b/c intactas (el sistema no marca otra)
    const after = locs.map((l) => (l.id === 'a' ? { ...l, active: false, is_default: false } : l))
    expect(after.some((l) => l.active && l.is_default)).toBe(false)         // ninguna default
    expect(initialLocationSelection(after)).toEqual({ mode: 'requires-choice', selectedId: null })
  })
  it('summarizeLocation arma una línea legible', () => {
    expect(summarizeLocation(mk({ line1: 'Av. Reforma', exterior_number: '100', interior_number: '4', neighborhood: 'Centro' })))
      .toBe('Av. Reforma 100 Int. 4, Centro, C.P. 06000, CDMX, CDMX')
  })
})

describe('CRUD del store sin conexión (modo mock) devuelve error controlado', () => {
  const fields = { name: 'X', line1: 'Y', postal_code: '1', city: 'C', state: 'S', country: 'México' } as never
  it('create/update/deactivate/setDefault → { ok:false } cuando no hay Supabase', async () => {
    expect((await createDoctorLocation(fields)).ok).toBe(false)
    expect((await updateDoctorLocation('id', {})).ok).toBe(false)
    expect((await deactivateDoctorLocation('id')).ok).toBe(false)
    expect((await setDefaultDoctorLocation('id')).ok).toBe(false)
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
  it('list scopea por el doctor seleccionado (staff no usa sus propias ubicaciones)', () => {
    expect(storeSrc).toMatch(/if \(doctorId\) q = q\.eq\('doctor_id', doctorId\)/)
  })
})

describe('checkout staff/POS — la RPC/CRUD queda tras allowManage (permisos §3)', () => {
  it('guardar ubicación y marcar predeterminada solo se ofrecen con allowManage', () => {
    // La captura persistible (LocationForm + guardar) está protegida por allowManage.
    expect(pickerSrc).toMatch(/mode !== 'legacy' && allowManage &&/)
    // Sin allowManage: captura one-off con AddressPicker, sin persistir.
    expect(pickerSrc).toMatch(/mode !== 'legacy' && !allowManage &&/)
  })
  it('crear ubicación y set-default solo ocurren dentro de saveNew (no en el flujo one-off)', () => {
    const creates = (pickerSrc.match(/createDoctorLocation\(/g) ?? []).length
    const setDefaults = (pickerSrc.match(/setDefaultDoctorLocation\(/g) ?? []).length
    expect(creates).toBe(1)      // una sola llamada, en saveNew
    expect(setDefaults).toBe(1)  // una sola llamada, en saveNew
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

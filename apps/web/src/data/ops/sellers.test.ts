// Resolver de vendedor (Prospectos): assigned_to → nombre legible. Garantía dura:
// la UI NUNCA muestra un uuid/código interno al operador.
import { describe, it, expect } from 'vitest'
import { resolveSellerName, type SellerLike } from './sellers'
import prospectosSrc from '../../screens/admin/Prospectos.tsx?raw'

const team: SellerLike[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Lucía Navarro', email: 'lucia@renovacell.mx' },
  { id: '22222222-2222-4222-8222-222222222222', name: '', email: 'sinnombre@renovacell.mx' },
]
const DEMO = { 'ventas1@renovacell.mx': 'Lucía · Ventas' }

describe('resolveSellerName — nunca expone uuid/código interno', () => {
  it('sin asignar (null/undefined/"") → "Sin asignar"', () => {
    expect(resolveSellerName(team, null)).toBe('Sin asignar')
    expect(resolveSellerName(team, undefined)).toBe('Sin asignar')
    expect(resolveSellerName(team, '')).toBe('Sin asignar')
  })
  it('uuid de perfil válido → nombre del vendedor', () => {
    expect(resolveSellerName(team, '11111111-1111-4111-8111-111111111111')).toBe('Lucía Navarro')
  })
  it('perfil sin nombre → cae al email del perfil (nunca el uuid)', () => {
    expect(resolveSellerName(team, '22222222-2222-4222-8222-222222222222')).toBe('sinnombre@renovacell.mx')
  })
  it('uuid SIN perfil → "Vendedor no disponible" (NUNCA el uuid)', () => {
    const orphan = '99999999-9999-4999-8999-999999999999'
    const out = resolveSellerName(team, orphan)
    expect(out).toBe('Vendedor no disponible')
    expect(out).not.toContain(orphan)
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i) // ningún uuid visible
  })
  it('assigned_to guardado como email de un perfil real → nombre', () => {
    expect(resolveSellerName(team, 'LUCIA@renovacell.mx')).toBe('Lucía Navarro') // case-insensitive
  })
  it('email sin perfil → fallback al correo (legible, no un código)', () => {
    expect(resolveSellerName(team, 'externo@correo.com')).toBe('externo@correo.com')
  })
  it('compat demo: email demo sin backend → nombre fijo', () => {
    expect(resolveSellerName([], 'ventas1@renovacell.mx', DEMO)).toBe('Lucía · Ventas')
  })
  it('Prospectos usa el resolver del directorio en todos los renders de vendedor', () => {
    expect(prospectosSrc).toMatch(/resolveSellerName/)
    expect(prospectosSrc).toMatch(/useSellerLabel/)
    // El label crudo del uuid ya no existe: sellerLabel pasa por el hook/resolver.
    expect(prospectosSrc).not.toMatch(/SELLER_NAMES\[id\] \?\? id/)
  })
})

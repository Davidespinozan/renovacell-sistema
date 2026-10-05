// Blindaje de Edge Functions (auditoría A-03/A-04/A-05). Verifica en el fuente que las
// funciones exigen autenticación/rol y no confían en datos del cliente. Sin llamadas reales.
import { describe, it, expect } from 'vitest'
import shippingSrc from '../../../../../supabase/functions/shipping/index.ts?raw'
import assistantSrc from '../../../../../supabase/functions/assistant/index.ts?raw'
import cedulaSrc from '../../../../../supabase/functions/verify-cedula/index.ts?raw'

describe('A-03 · shipping exige usuario + rol de logística antes de llamar al agregador', () => {
  it('resuelve al llamante (W6-A1: resolverQuien) y whitelist admin/warehouse/packing', () => {
    expect(shippingSrc).toMatch(/resolverQuien\(/)
    expect(shippingSrc).toMatch(/\['admin', 'warehouse', 'packing'\]/)
    expect(shippingSrc).toMatch(/401/)
    expect(shippingSrc).toMatch(/403/)
  })
  it('la autenticación ocurre ANTES del fetch al proveedor', () => {
    const auth = shippingSrc.indexOf('resolverQuien(')
    const firstFetch = shippingSrc.indexOf('fetch(') // primer llamado saliente al proveedor
    expect(auth).toBeGreaterThan(-1)
    expect(firstFetch).toBeGreaterThan(auth)
  })
})

describe('A-04 · assistant: modo doctor exige sesión, topa entradas y no filtra el error', () => {
  it('modo doctor requiere sesión (W6-A1: resolverQuien responde 401/403)', () => {
    expect(assistantSrc).toMatch(/mode === 'doctor'/)
    expect(assistantSrc).toMatch(/resolverQuien\(/)
    expect(assistantSrc).toMatch(/if \(!q\.ok\) return json\(q\.status, q\.body\)/)
  })
  it('topa el contenido de cada turno y el catálogo', () => {
    expect(assistantSrc).toMatch(/slice\(0, 4000\)/)
    expect(assistantSrc).toMatch(/slice\(0, 80\)/)
  })
  it('el catch NO devuelve el mensaje interno del error', () => {
    expect(assistantSrc).not.toMatch(/\(e as Error\)\.message/)
    expect(assistantSrc).toMatch(/No se pudo contactar al asistente/)
  })
})

describe('A-05 · verify-cedula: el doctor se coteja contra el nombre de SU perfil', () => {
  it('usa prof.full_name para el doctor, no el name del cliente', () => {
    expect(cedulaSrc).toMatch(/isDoctor \? \(prof\?\.full_name \?\? ''\) : \(payload\.name \?\? ''\)/)
  })
})

// Blindaje de Edge Functions (auditoría A-03/A-04/A-05). Verifica en el fuente que las
// funciones exigen autenticación/rol y no confían en datos del cliente. Sin llamadas reales.
import { describe, it, expect } from 'vitest'
import shippingSrc from '../../../../../supabase/functions/shipping/index.ts?raw'
import assistantSrc from '../../../../../supabase/functions/assistant/index.ts?raw'
import cedulaSrc from '../../../../../supabase/functions/verify-cedula/index.ts?raw'

describe('A-03 · shipping exige usuario + rol de logística antes de llamar al agregador', () => {
  it('tiene getUser() y whitelist admin/warehouse/packing', () => {
    expect(shippingSrc).toMatch(/auth\.getUser\(\)/)
    expect(shippingSrc).toMatch(/\['admin', 'warehouse', 'packing'\]/)
    expect(shippingSrc).toMatch(/401/)
    expect(shippingSrc).toMatch(/403/)
  })
  it('la autenticación ocurre ANTES del fetch al proveedor', () => {
    const auth = shippingSrc.indexOf('auth.getUser()')
    const firstFetch = shippingSrc.indexOf('fetch(base')
    expect(auth).toBeGreaterThan(-1)
    expect(firstFetch).toBeGreaterThan(auth)
  })
})

describe('A-04 · assistant: modo doctor exige sesión, topa entradas y no filtra el error', () => {
  it('modo doctor requiere getUser()', () => {
    expect(assistantSrc).toMatch(/mode === 'doctor'/)
    expect(assistantSrc).toMatch(/auth\.getUser\(\)/)
    expect(assistantSrc).toMatch(/No autenticado/)
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

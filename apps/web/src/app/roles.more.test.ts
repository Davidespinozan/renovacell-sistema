// Casos adicionales de roles/navegación.
import { describe, it, expect } from 'vitest'
import { getRole, getNav, getScreenDef, getEntryScreen, availableRoles, capabilityModules, canManageHub } from './roles'

describe('getScreenDef', () => {
  it('resuelve una pantalla dentro del alcance del rol', () => {
    const role = getRole('admin')
    const first = getNav(role)[0]
    expect(getScreenDef(role, first.key).key).toBe(first.key)
  })
  it('una key inexistente cae a la primera pantalla', () => {
    const role = getRole('warehouse')
    const def = getScreenDef(role, 'no-existe-xyz')
    expect(def).toBeTruthy()
    expect(getNav(role).some((s) => s.key === def.key)).toBe(true)
  })
})

describe('getEntryScreen', () => {
  it('cada rol tiene una pantalla de entrada válida', () => {
    ;(['admin', 'warehouse', 'pos', 'driver', 'doctor'] as const).forEach((k) => {
      expect(typeof getEntryScreen(getRole(k))).toBe('string')
      expect(getEntryScreen(getRole(k)).length).toBeGreaterThan(0)
    })
  })
})

describe('capabilityModules — combinación', () => {
  it('varias capabilities suman sus módulos', () => {
    const keys = capabilityModules(['diseno', 'eventos']).map((m) => m.key)
    expect(keys).toContain('dis_calendario')
    expect(keys).toContain('eventos')
  })
})

describe('availableRoles', () => {
  it('devuelve una lista no vacía de roles', () => {
    expect(availableRoles().length).toBeGreaterThan(0)
  })
})

describe('canManageHub — matriz', () => {
  it('solo admin gestiona', () => {
    ;(['warehouse', 'pos', 'driver', 'doctor'] as const).forEach((k) => expect(canManageHub(k)).toBe(false))
    expect(canManageHub('admin')).toBe(true)
  })
})

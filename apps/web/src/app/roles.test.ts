// Pruebas de roles, capabilities y armado de navegación (gobierno de accesos).
import { describe, it, expect } from 'vitest'
import { getRole, capabilityModules, getNav, getEntryScreen, canManageHub, availableRoles } from './roles'

describe('getRole', () => {
  it('devuelve el rol pedido', () => {
    expect(getRole('admin').key).toBe('admin')
    expect(getRole('warehouse').key).toBe('warehouse')
  })
})

describe('capabilityModules', () => {
  it('la capability Diseño aporta Solicitudes y Calendario', () => {
    const keys = capabilityModules(['diseno']).map((m) => m.key)
    expect(keys).toContain('dis_solicitudes')
    expect(keys).toContain('dis_calendario')
  })
  it('capabilities desconocidas no aportan módulos', () => {
    expect(capabilityModules(['inexistente'])).toEqual([])
  })
  it('sin capabilities, sin módulos', () => {
    expect(capabilityModules([])).toEqual([])
  })
})

describe('getNav', () => {
  it('suma los módulos de las capabilities al rol base (sin duplicar)', () => {
    const base = getNav(getRole('warehouse')).map((s) => s.key)
    const conDiseno = getNav(getRole('warehouse'), undefined, ['diseno']).map((s) => s.key)
    expect(conDiseno).toContain('dis_calendario')
    expect(conDiseno.length).toBeGreaterThan(base.length)
    // sin claves repetidas
    expect(new Set(conDiseno).size).toBe(conDiseno.length)
  })
})

describe('getEntryScreen', () => {
  it('es la primera pantalla de la navegación del rol', () => {
    const role = getRole('admin')
    expect(getEntryScreen(role)).toBe(getNav(role)[0].key)
  })
})

describe('canManageHub', () => {
  it('solo Administración gestiona la vista común', () => {
    expect(canManageHub('admin')).toBe(true)
    expect(canManageHub('warehouse')).toBe(false)
    expect(canManageHub('doctor')).toBe(false)
  })
})

describe('availableRoles', () => {
  it('siempre incluye admin y doctor', () => {
    const keys = availableRoles().map((r) => r.key)
    expect(keys).toContain('admin')
    expect(keys).toContain('doctor')
  })
})

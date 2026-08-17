import { describe, it, expect } from 'vitest'
import { traducirError } from './errorMsg'

describe('traducirError', () => {
  it('traduce códigos de negocio de las RPCs', () => {
    expect(traducirError('ESTADO_TERMINAL: un pedido delivered no puede cambiar')).toMatch(/cerrado/i)
    expect(traducirError('LEDGER_APPEND_ONLY: audit_logs es inmutable')).toMatch(/histórico|no se edita/i)
    expect(traducirError(new Error('MOTIVO_REQUERIDO'))).toMatch(/motivo/i)
    expect(traducirError('SIN_STOCK')).toMatch(/existencia/i)
  })
  it('traduce errores de auth de Supabase (inglés → operador)', () => {
    expect(traducirError('Invalid login credentials')).toMatch(/incorrectos/i)
    expect(traducirError({ message: 'Password should be at least 6 characters' })).toMatch(/6 caracteres/i)
  })
  it('traduce técnicos (RLS, red) sin exponer el código', () => {
    expect(traducirError('42501: new row violates row-level security')).toMatch(/permiso/i)
    expect(traducirError('Failed to fetch')).toMatch(/conexión/i)
    expect(traducirError('PGRST116')).not.toMatch(/PGRST/)
  })
  it('cae a un fallback honesto si no reconoce nada', () => {
    expect(traducirError('')).toMatch(/no se pudo/i)
    expect(traducirError('X7Z9QK')).toMatch(/no se pudo/i)  // código crudo → fallback
    expect(traducirError(null, 'Mensaje propio')).toBe('Mensaje propio')
  })
})

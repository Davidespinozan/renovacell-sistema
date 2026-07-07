// Pruebas de utilidades de formato (moneda, fecha relativa, iniciales, avatar).
import { describe, it, expect } from 'vitest'
import { money, timeAgo, initials, avatarColor } from './format'

describe('money', () => {
  it('formatea MXN sin decimales', () => {
    expect(money(1000)).toContain('1,000')
    expect(money(0)).toContain('0')
  })
  it('null/undefined = "a consultar" (producto profesional)', () => {
    expect(money(null)).toBe('a consultar')
    expect(money(undefined)).toBe('a consultar')
  })
})

describe('timeAgo', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
  it('menos de un minuto = "ahora"', () => {
    expect(timeAgo(ago(10_000))).toBe('ahora')
  })
  it('minutos y horas', () => {
    expect(timeAgo(ago(5 * 60_000))).toBe('hace 5 min')
    expect(timeAgo(ago(3 * 3_600_000))).toBe('hace 3 h')
  })
  it('días (menos de una semana)', () => {
    expect(timeAgo(ago(2 * 86_400_000))).toBe('hace 2 d')
  })
  it('más de una semana cae a fecha', () => {
    expect(timeAgo('2020-01-01T00:00:00Z')).not.toContain('hace')
  })
})

describe('initials', () => {
  it('toma la primera letra de nombre y apellido', () => {
    expect(initials('Claudia Dirección')).toBe('CD')
    expect(initials('Alberto')).toBe('A')
  })
  it('nombre vacío = "?"', () => {
    expect(initials('   ')).toBe('?')
  })
})

describe('avatarColor', () => {
  it('es determinista para el mismo nombre', () => {
    expect(avatarColor('Renovacell')).toBe(avatarColor('Renovacell'))
  })
  it('devuelve un color de la paleta', () => {
    expect(avatarColor('x')).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})

// Casos límite adicionales de formato.
import { describe, it, expect } from 'vitest'
import { money, timeAgo, initials, avatarColor, fmtDate } from './format'

describe('money — límites', () => {
  it('formatea negativos', () => {
    expect(money(-500)).toContain('500')
  })
  it('redondea sin decimales', () => {
    expect(money(1234.7)).not.toContain('.7')
  })
})

describe('timeAgo — frontera exacta', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
  it('59 min sigue en minutos', () => {
    expect(timeAgo(ago(59 * 60_000))).toBe('hace 59 min')
  })
  it('exactamente 1 h', () => {
    expect(timeAgo(ago(60 * 60_000))).toBe('hace 1 h')
  })
  it('6 días sigue en días', () => {
    expect(timeAgo(ago(6 * 86_400_000))).toBe('hace 6 d')
  })
})

describe('initials — más casos', () => {
  it('tres nombres usa el primero y el segundo', () => {
    expect(initials('José Antonio Gallardo')).toBe('JA')
  })
  it('en mayúsculas', () => {
    expect(initials('ana lopez')).toBe('AL')
  })
})

describe('avatarColor — paleta cerrada', () => {
  it('siempre cae dentro de la paleta', () => {
    const palette = ['#007311', '#2C6E8F', '#7A4E97', '#B5730E', '#3d6359', '#A8864E']
    for (const name of ['a', 'bb', 'Renovacell', 'Claudia', 'Zzz', '']) {
      expect(palette).toContain(avatarColor(name))
    }
  })
})

describe('fmtDate', () => {
  it('formatea una fecha ISO a texto', () => {
    const out = fmtDate('2026-07-15T10:00:00Z')
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
  })
})

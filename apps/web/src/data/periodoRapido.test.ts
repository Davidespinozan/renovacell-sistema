import { describe, expect, it } from 'vitest'
import { rangoPeriodo } from './periodo'

// 26 nov 2026 es jueves.
describe('periodos rápidos de Ventas', () => {
  it('hoy y ayer son un solo día', () => {
    expect(rangoPeriodo('hoy', '2026-11-26')).toEqual({ from: '2026-11-26', to: '2026-11-26' })
    expect(rangoPeriodo('ayer', '2026-11-26')).toEqual({ from: '2026-11-25', to: '2026-11-25' })
  })
  it('la semana empieza en lunes, también cuando hoy es domingo o lunes', () => {
    expect(rangoPeriodo('semana', '2026-11-26')).toEqual({ from: '2026-11-23', to: '2026-11-26' })
    expect(rangoPeriodo('semana', '2026-11-29')).toEqual({ from: '2026-11-23', to: '2026-11-29' })   // domingo
    expect(rangoPeriodo('semana', '2026-11-23')).toEqual({ from: '2026-11-23', to: '2026-11-23' })   // lunes
  })
  it('el mes va del día 1 a hoy, y «todo» no lleva fechas', () => {
    expect(rangoPeriodo('mes', '2026-11-26')).toEqual({ from: '2026-11-01', to: '2026-11-26' })
    expect(rangoPeriodo('todo', '2026-11-26')).toEqual({ from: '', to: '' })
  })
  it('ayer cruza de mes sin romperse', () => {
    expect(rangoPeriodo('ayer', '2026-12-01')).toEqual({ from: '2026-11-30', to: '2026-11-30' })
  })
})

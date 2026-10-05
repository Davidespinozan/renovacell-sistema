// W5 · Reloj del negocio: una sola semántica de día (America/Mazatlan).
import { describe, it, expect } from 'vitest'
import {
  diaNegocio, hoyNegocio, mesNegocio, sumarDias, sumarMeses, diasEntre, primerDiaMes, ultimoDiaMes,
  periodoMes, esteMes, mesPasado, ultimosDias, periodoAnterior, enPeriodo, ultimosMeses, etiquetaMes, todoElHistorico,
} from './periodo'

describe('diaNegocio', () => {
  it('23:30 de Mazatlán del último día del mes sigue siendo ese mes', () => {
    expect(diaNegocio('2026-11-01T06:30:00Z')).toBe('2026-10-31')
  })
  it('17:00 locales: el corte por UTC lo mandaría al día siguiente', () => {
    expect(diaNegocio('2026-10-06T00:00:00Z')).toBe('2026-10-05')
    expect(new Date('2026-10-06T00:00:00Z').toISOString().slice(0, 10)).toBe('2026-10-06') // lo que hacía antes
  })
  it('no depende del reloj del dispositivo: acepta instantes con cualquier desfase', () => {
    expect(diaNegocio('2026-10-31T23:30:00+09:00')).toBe('2026-10-31')
    expect(diaNegocio(new Date('2026-11-01T06:59:59Z'))).toBe('2026-10-31')
    expect(diaNegocio(Date.UTC(2026, 10, 1, 7, 0, 0))).toBe('2026-11-01')
  })
  it('una fecha sin hora YA es un día del negocio y se respeta tal cual', () => {
    expect(diaNegocio('2026-10-31')).toBe('2026-10-31') // como medianoche UTC sería 30-oct en Mazatlán
  })
  it('entrada inválida → cadena vacía (nunca una fecha inventada)', () => {
    expect(diaNegocio('no-es-fecha')).toBe('')
  })
  it('hoyNegocio y mesNegocio derivan del mismo corte', () => {
    const t = new Date('2026-11-01T06:30:00Z')
    expect(hoyNegocio(t)).toBe('2026-10-31')
    expect(mesNegocio(t)).toBe('2026-10')
  })
})

describe('aritmética de calendario', () => {
  it('suma días cruzando mes y año bisiesto', () => {
    expect(sumarDias('2026-10-31', 1)).toBe('2026-11-01')
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29')
    expect(sumarDias('2027-01-01', -1)).toBe('2026-12-31')
  })
  it('suma meses con desborde y último día del mes', () => {
    expect(sumarMeses('2026-12', 1)).toBe('2027-01')
    expect(sumarMeses('2026-01', -1)).toBe('2025-12')
    expect(ultimoDiaMes('2026-02')).toBe('2026-02-28')
    expect(ultimoDiaMes('2028-02')).toBe('2028-02-29')
    expect(primerDiaMes('2026-10')).toBe('2026-10-01')
  })
  it('diasEntre cuenta días de calendario', () => {
    expect(diasEntre('2026-10-01', '2026-10-31')).toBe(30)
    expect(diasEntre('2026-10-31', '2026-10-01')).toBe(-30)
  })
})

describe('periodos', () => {
  const ahora = new Date('2026-11-01T06:30:00Z') // 31-oct 23:30 en Mazatlán
  it('"este mes" es el mes CALENDARIO del negocio, con su etiqueta explícita', () => {
    expect(esteMes(ahora)).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-31', etiqueta: 'Este mes · octubre 2026' })
    expect(mesPasado(ahora)).toMatchObject({ desde: '2026-09-01', hasta: '2026-09-30', etiqueta: 'Mes pasado · septiembre 2026' })
  })
  it('"últimos N días" son N días de calendario, hoy incluido', () => {
    expect(ultimosDias(90, ahora)).toMatchObject({ desde: '2026-08-03', hasta: '2026-10-31' })
  })
  it('el periodo anterior es del mismo tamaño', () => {
    expect(periodoAnterior(periodoMes('2026-10'))).toMatchObject({ desde: '2026-09-01', hasta: '2026-09-30' })
    expect(periodoAnterior(ultimosDias(90, ahora))).toMatchObject({ desde: '2026-05-05', hasta: '2026-08-02' })
    expect(periodoAnterior(todoElHistorico())).toBeNull()
  })
  it('enPeriodo corta por día del negocio, inclusive en ambos extremos', () => {
    const oct = periodoMes('2026-10')
    expect(enPeriodo('2026-10-01T07:00:00Z', oct)).toBe(true)   // primer instante
    expect(enPeriodo('2026-10-01T06:59:59Z', oct)).toBe(false)  // un segundo antes
    expect(enPeriodo('2026-11-01T06:59:59Z', oct)).toBe(true)   // último segundo
    expect(enPeriodo('2026-11-01T07:00:00Z', oct)).toBe(false)
    expect(enPeriodo('2026-10-31', oct)).toBe(true)              // fecha contable sin hora
    expect(enPeriodo('x', oct)).toBe(false)
    expect(enPeriodo('1999-01-01T00:00:00Z', todoElHistorico())).toBe(true)
  })
  it('ultimosMeses va del más antiguo al actual', () => {
    expect(ultimosMeses(3, ahora)).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(etiquetaMes('2026-10')).toBe('octubre 2026')
  })
})

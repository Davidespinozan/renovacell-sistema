// Casos adicionales de finanzas: arqueo sin filtro. (El estado de resultados y la CxC viven en data/kpis.ts.)
import { describe, it, expect } from 'vitest'
import { efectivoEsperado } from './finanzas'
import { mkOrder } from '../../test/factories'

describe('efectivoEsperado — sin filtro', () => {
  it('suma todas las ventas POS en efectivo cuando no se filtra', () => {
    const r = efectivoEsperado([
      mkOrder({ id: '1', external_ref: 'POS-1', payment_method: 'efectivo', total: 100 }),
      mkOrder({ id: '2', external_ref: 'POS-2', payment_method: 'efectivo', total: 200 }),
      mkOrder({ id: '3', external_ref: 'S-1', payment_method: 'efectivo', total: 999 }), // no POS
    ], {})
    expect(r).toBe(300)
  })
})


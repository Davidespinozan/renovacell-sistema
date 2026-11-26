// POR-COBRAR (26 nov 2026, dueño): «Cobrar más tarde» en Punto de venta y Levantar pedido, sin crédito ni referencia.
import { describe, it, expect } from 'vitest'
import { FORMAS, faltaEnCobro, formaNoDisponible, cobroParaServidor, resultadoCobro } from './cobro'
import { textoMetodoPago } from './money'
import mig from '../../../../../supabase/migrations/20270407960000_cobrar_mas_tarde.sql?raw'

describe('cobrar más tarde', () => {
  it('es una forma de «paga después», disponible en mostrador y en pedido, sin datos extra', () => {
    expect(FORMAS.find((f) => f.id === 'por_cobrar')?.grupo).toBe('despues')
    expect(formaNoDisponible('por_cobrar', 'mostrador')).toBeNull()
    expect(formaNoDisponible('por_cobrar', 'pedido', 'foraneo')).toBeNull()
    expect(faltaEnCobro({ forma: 'por_cobrar' }, 5000, 'mostrador', null, '2026-11-26')).toBeNull()
    expect(cobroParaServidor({ forma: 'por_cobrar', referencia: 'x' })).toEqual({ forma: 'por_cobrar' })
    expect(resultadoCobro({ forma: 'por_cobrar' }).pagado).toBe(false)
    expect(textoMetodoPago('por_cobrar')).toBe('Por cobrar')
  })
  it('el servidor: sin asiento ni crédito; la venta queda pendiente', () => {
    expect(mig).toMatch(/elsif v_forma = 'por_cobrar' then/)
    expect(mig).toMatch(/case when v_metodo in \('credito', 'por_cobrar'\) then 'pending' else 'paid' end/)
    expect(mig).toMatch(/elsif v_metodo = 'por_cobrar' then[\s\S]{0,300}null;\s+else\s+perform public\._w2_asiento/)
  })
})

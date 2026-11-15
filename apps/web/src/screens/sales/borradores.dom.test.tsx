// @vitest-environment jsdom
// BORRADORES (15 nov 2026, equipo: "que no se borre el pedido levantado ni la cotización").
import { describe, it, expect } from 'vitest'
import { leerBorrador, borrarBorrador } from '../../data/store/borradores'
import { renderHook } from '@testing-library/react'
import { useGuardarBorrador } from '../../data/store/borradores'

describe('Borradores', () => {
  it('guarda mientras se arma, se recupera y se borra al terminar', () => {
    const { rerender } = renderHook(({ v }) => useGuardarBorrador('cotizacion:ana@x:C1', v, false), { initialProps: { v: { cart: { P1: 2 }, notas: 'urgente' } } })
    expect(leerBorrador<{ cart: Record<string, number> }>('cotizacion:ana@x:C1')?.cart).toEqual({ P1: 2 })
    rerender({ v: { cart: { P1: 3 }, notas: 'urgente' } })
    expect(leerBorrador<{ cart: Record<string, number> }>('cotizacion:ana@x:C1')?.cart).toEqual({ P1: 3 })
    borrarBorrador('cotizacion:ana@x:C1')
    expect(leerBorrador('cotizacion:ana@x:C1')).toBeNull()
  })
  it('vacío no se guarda; otra persona del equipo no ve el borrador', () => {
    renderHook(() => useGuardarBorrador('pedido:ana@x:C1', { cart: {} }, true))
    expect(leerBorrador('pedido:ana@x:C1')).toBeNull()
    renderHook(() => useGuardarBorrador('pedido:ana@x:C2', { cart: { P: 1 } }, false))
    expect(leerBorrador('pedido:beto@x:C2')).toBeNull()
  })
})

// @vitest-environment jsdom
// FACTURACIÓN · RESUMEN (27 nov 2026): lo que pide acción en grande (por emitir, emitidos, por cobrar) y lo demás en una
// línea, igual que en Ventas. Antes eran cinco tarjetas. Las mismas cifras siguen ahí; los nombres ya no van en MAYÚSCULAS.
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, cleanup, within } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Facturacion } from './Facturacion'

beforeEach(cleanup)

describe('<Facturacion> · resumen', () => {
  it('tres cifras a la vista y las otras dos en la línea de abajo', () => {
    renderWithRole(<Facturacion />)
    const r = screen.getByTestId('fact-resumen')
    for (const t of ['Por emitir', 'Emitidos', 'Por cobrar', 'CFDI solicitados por el cliente', 'Cobrado histórico']) expect(r).toHaveTextContent(t)
    expect(within(r).getByTestId('fact-por-emitir').textContent).toMatch(/^\d+$/)
    expect(within(r).getByTestId('fact-emitidos').textContent).toMatch(/^\d+$/)
    expect(document.querySelector('.sigs')).toBeNull()                       // ya no hay cinco tarjetas
  })
  it('en la tabla el cobro usa las palabras de todo el sistema', () => {
    renderWithRole(<Facturacion />)
    const celdas = Array.from(document.querySelectorAll('td[data-label="Cobro"]')).map((c) => c.textContent ?? '')
    expect(celdas.length).toBeGreaterThan(0)
    for (const c of celdas) expect(['Pendiente', 'Sin pago', 'No liberado', 'Liberado por cobro'].some((v) => c.includes(v)), c).toBe(false)
  })
})

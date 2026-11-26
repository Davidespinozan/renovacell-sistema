// @vitest-environment jsdom
// COMPRA CON FACTURA · a mano (sin archivo) se registra una compra con varios productos; sin producto elegido no deja.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ llamadas: [] as Array<Record<string, unknown>> }))
vi.mock('../../data/ops/compraFactura', async (orig) => ({ ...(await orig<object>()),
  leerEquivalencias: async () => [],
  crearCompra: async (_op: string, c: unknown, r: unknown[]) => { h.llamadas.push({ c, r }); return { ok: true, renglones: r.length } } }))
import { RegistrarCompraModal } from './RegistrarCompraModal'
beforeEach(() => { cleanup(); h.llamadas = [] })

const productos = [{ id: 'p1', name: 'NABOTA 100 UI', sku: 'TOX-007', active: true }, { id: 'p2', name: 'Botox 100 UI', sku: 'TOX-001', active: true }] as never

describe('registrar compra a mano', () => {
  it('dos productos, proveedor y costos → una compra con dos renglones', async () => {
    const hecho = vi.fn()
    render(<RegistrarCompraModal productos={productos} onClose={() => {}} onHecho={hecho} />)
    const registrar = screen.getByTestId('compra-registrar') as HTMLButtonElement
    expect(registrar.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('compra-proveedor'), { target: { value: 'Distribuidora X' } })
    fireEvent.click(screen.getByTestId('compra-agregar'))
    const prods = screen.getAllByTestId('compra-producto'); const cant = screen.getAllByTestId('compra-cantidad'); const costo = screen.getAllByTestId('compra-costo')
    fireEvent.change(prods[0], { target: { value: 'p1' } }); fireEvent.change(cant[0], { target: { value: '20' } }); fireEvent.change(costo[0], { target: { value: '900' } })
    expect(registrar.disabled).toBe(true)   // falta el segundo renglón
    fireEvent.change(prods[1], { target: { value: 'p2' } }); fireEvent.change(cant[1], { target: { value: '5' } }); fireEvent.change(costo[1], { target: { value: '3200' } })
    expect(registrar.disabled).toBe(false)
    fireEvent.click(registrar)
    await waitFor(() => expect(hecho).toHaveBeenCalled())
    expect(h.llamadas[0]).toMatchObject({ c: { proveedor: 'Distribuidora X', origen: 'manual' }, r: [{ product_id: 'p1', qty: 20, unit_cost: 900 }, { product_id: 'p2', qty: 5, unit_cost: 3200 }] })
  })
})

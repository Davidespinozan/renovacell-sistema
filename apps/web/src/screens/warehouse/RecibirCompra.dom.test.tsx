// @vitest-environment jsdom
// RECIBIR LA COMPRA COMPLETA (27 nov 2026): todos los productos de una compra en una pantalla; cada uno entra con el
// comando de siempre y su propio op_id. Lo que no se captura queda por recibir.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ recibir: vi.fn() }))
vi.mock('../../data/hooks/useLots', () => ({ useLots: () => ({ data: [], recibirLote: h.recibir }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'p1', name: 'Alfa' }, { id: 'p2', name: 'Beta' }, { id: 'p3', name: 'Gama' }] }) }))
import { RecibirCompraModal } from './RecibirCompraModal'

const linea = (id: string, pid: string, nombre: string, qty: number) => ({ id, product_id: pid, product_name: nombre, qty, unit_cost: 100, kind: 'compra' as const, supplier: 'Proveedor X', status: 'pendiente' as const, paid: false, created_at: '2026-11-24T10:00:00Z', received_qty: 0, compra_id: 'c1' })
const COMPRA = { compra_id: 'c1', proveedor: 'Proveedor X', fecha: '2026-11-24T10:00:00Z', lineas: [linea('r1', 'p1', 'Alfa', 10), linea('r2', 'p2', 'Beta', 5), linea('r3', 'p3', 'Gama', 8)] }
const llenar = (producto: string, lote: string, cad: string) => {
  fireEvent.change(screen.getByLabelText(`Lote de ${producto}`), { target: { value: lote } })
  fireEvent.change(screen.getByLabelText(`Caducidad de ${producto}`), { target: { value: cad } })
}

beforeEach(() => { cleanup(); h.recibir.mockReset() })

describe('<RecibirCompraModal>', () => {
  it('la cantidad ya viene con lo pendiente y el botón dice qué falta', () => {
    render(<RecibirCompraModal compra={COMPRA} onClose={() => {}} onDone={() => {}} />)
    expect((screen.getByLabelText('Cantidad que llegó de Alfa') as HTMLInputElement).value).toBe('10')
    expect(screen.getByTestId('rc-pista')).toHaveTextContent('Captura el lote y la caducidad de lo que llegó.')
    expect((screen.getByTestId('rc-confirmar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Lote de Alfa'), { target: { value: 'L-1' } })
    expect(screen.getByTestId('rc-pista')).toHaveTextContent('A Alfa le falta la caducidad.')
    expect((screen.getByTestId('rc-confirmar') as HTMLButtonElement).disabled).toBe(true)
  })

  it('recibe lo capturado con un solo botón; lo que quedó en blanco sigue por recibir', async () => {
    h.recibir.mockResolvedValue({ ok: true })
    const onDone = vi.fn()
    render(<RecibirCompraModal compra={COMPRA} onClose={() => {}} onDone={onDone} />)
    llenar('Alfa', 'L-1', '2027-06-30'); llenar('Beta', 'L-2', '2027-08-31')
    fireEvent.change(screen.getByLabelText('Cantidad que llegó de Beta'), { target: { value: '3' } })
    expect(screen.getByTestId('rc-pista')).toHaveTextContent('1 producto sin capturar se queda por recibir.')
    expect(screen.getByTestId('rc-confirmar')).toHaveTextContent('Confirmar recepción (2 productos)')
    fireEvent.click(screen.getByTestId('rc-confirmar'))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Recibiste 2 productos: ya están en inventario. Quedan 1 por recibir.'))
    expect(h.recibir).toHaveBeenCalledTimes(2)
    expect(h.recibir).toHaveBeenNthCalledWith(1, expect.objectContaining({ product_id: 'p1', lot_code: 'L-1', expiry_date: '2027-06-30', quantity: 10, replenishment_id: 'r1', kind: 'orden', unit_cost: 100 }))
    expect(h.recibir).toHaveBeenNthCalledWith(2, expect.objectContaining({ product_id: 'p2', quantity: 3, replenishment_id: 'r2' }))
    const ops = h.recibir.mock.calls.map((c) => c[0].op_id)
    expect(new Set(ops).size).toBe(2)   // cada renglón, su propia operación
  })

  it('si un producto no entra, los demás sí; se dice cuál y se reintenta SOLO ese con la misma operación', async () => {
    h.recibir.mockImplementation(async (i: { product_id: string }) => (i.product_id === 'p2' ? { ok: false, error: 'Sin conexión.' } : { ok: true }))
    const onDone = vi.fn()
    render(<RecibirCompraModal compra={COMPRA} onClose={() => {}} onDone={onDone} />)
    llenar('Alfa', 'L-1', '2027-06-30'); llenar('Beta', 'L-2', '2027-08-31'); llenar('Gama', 'L-3', '2027-09-30')
    fireEvent.click(screen.getByTestId('rc-confirmar'))
    await waitFor(() => expect(screen.getByTestId('rc-aviso')).toHaveTextContent('Entraron 2 de 3. No entró: Beta. Sin conexión.'))
    expect(onDone).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Lote de Alfa') as HTMLInputElement).disabled).toBe(true)    // ya recibido: no se vuelve a mandar
    const opBeta = h.recibir.mock.calls.find((c) => c[0].product_id === 'p2')![0].op_id
    h.recibir.mockResolvedValue({ ok: true })
    fireEvent.click(screen.getByTestId('rc-confirmar'))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Recibiste 1 producto: ya están en inventario.'))
    expect(h.recibir).toHaveBeenCalledTimes(4)
    expect(h.recibir.mock.calls[3][0]).toEqual(expect.objectContaining({ product_id: 'p2', op_id: opBeta }))
  })

  it('no deja recibir más de lo pendiente', () => {
    render(<RecibirCompraModal compra={COMPRA} onClose={() => {}} onDone={() => {}} />)
    llenar('Beta', 'L-2', '2027-08-31')
    fireEvent.change(screen.getByLabelText('Cantidad que llegó de Beta'), { target: { value: '6' } })
    expect(screen.getByTestId('rc-pista')).toHaveTextContent('A Beta le falta una cantidad que no pase de lo pendiente.')
    expect((screen.getByTestId('rc-confirmar') as HTMLButtonElement).disabled).toBe(true)
  })
})

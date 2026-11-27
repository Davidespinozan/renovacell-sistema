import { describe, expect, it } from 'vitest'
import { comprasPorRecibir, estadoLinea, resumenRecepcion } from './recibirCompra'
import type { PurchaseOrder } from '../store/comprasStore'

const po = (id: string, nombre: string, compra_id: string | null, created_at = '2026-11-24T10:00:00Z'): PurchaseOrder =>
  ({ id, product_id: 'p' + id, product_name: nombre, qty: 10, unit_cost: 100, kind: 'compra', supplier: 'Proveedor X', status: 'pendiente', paid: false, created_at, received_qty: 0, compra_id })

describe('recibir la compra completa', () => {
  it('junta los renglones abiertos de la misma compra; un renglón suelto no forma grupo', () => {
    const g = comprasPorRecibir([po('1', 'Zeta', 'c1'), po('2', 'Alfa', 'c1'), po('3', 'Solo', 'c2'), po('4', 'Sin compra', null)])
    expect(g).toHaveLength(1)
    expect(g[0].compra_id).toBe('c1')
    expect(g[0].lineas.map((l) => l.product_name)).toEqual(['Alfa', 'Zeta'])
    expect(g[0].proveedor).toBe('Proveedor X')
  })
  it('la compra más antigua va primero', () => {
    const g = comprasPorRecibir([po('1', 'A', 'nueva', '2026-11-26T10:00:00Z'), po('2', 'B', 'nueva', '2026-11-26T10:00:00Z'), po('3', 'C', 'vieja', '2026-11-20T10:00:00Z'), po('4', 'D', 'vieja', '2026-11-20T10:00:00Z')])
    expect(g.map((x) => x.compra_id)).toEqual(['vieja', 'nueva'])
  })
  it('un renglón vacío es «no llegó»; a medio llenar dice qué le falta', () => {
    expect(estadoLinea({ lote: '', caducidad: '', cantidad: 10 }, 10)).toEqual({ estado: 'vacia' })
    expect(estadoLinea({ lote: 'L1', caducidad: '', cantidad: 10 }, 10)).toEqual({ estado: 'falta', falta: 'la caducidad' })
    expect(estadoLinea({ lote: ' ', caducidad: '2027-01-01', cantidad: 10 }, 10)).toEqual({ estado: 'falta', falta: 'el lote' })
    expect(estadoLinea({ lote: 'L1', caducidad: '2027-01-01', cantidad: 0 }, 10)).toEqual({ estado: 'falta', falta: 'la cantidad que llegó' })
    expect(estadoLinea({ lote: 'L1', caducidad: '2027-01-01', cantidad: 11 }, 10)).toEqual({ estado: 'falta', falta: 'una cantidad que no pase de lo pendiente' })
    expect(estadoLinea({ lote: 'L1', caducidad: '2027-01-01', cantidad: 4 }, 10)).toEqual({ estado: 'lista' })
  })
  it('el resumen nunca dice «todo bien» si un producto no entró', () => {
    expect(resumenRecepcion([{ producto: 'A', ok: true }, { producto: 'B', ok: true }], 0)).toEqual({ ok: true, texto: 'Recibiste 2 productos: ya están en inventario.' })
    expect(resumenRecepcion([{ producto: 'A', ok: true }], 2).texto).toBe('Recibiste 1 producto: ya están en inventario. Quedan 2 por recibir.')
    const r = resumenRecepcion([{ producto: 'A', ok: true }, { producto: 'B', ok: false, error: 'Sin conexión.' }], 0)
    expect(r).toEqual({ ok: false, texto: 'Entraron 1 de 2. No entró: B. Sin conexión.' })
  })
})

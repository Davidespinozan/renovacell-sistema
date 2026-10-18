// @vitest-environment jsdom
// PROMO-2 · Pantalla de promociones: pegar el texto del proveedor propone la promoción con los productos emparejados;
// se revisa y se guarda por el comando (promocion_guardar); pausar/activar; la lista muestra estado y vigencia.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Promociones, emparejarProducto } from './Promociones'
import type { Promocion } from '../../data/ops/promociones'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn(), from: vi.fn() } }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'B', name: 'Botox 100 UI', price: 4600, active: true }, { id: 'S', name: 'SkinVive', price: 4500, active: true }, { id: 'H', name: 'HArmonyCa', price: 8000, active: true }, { id: 'M', name: 'Mascarilla GP', price: 890, active: true }] }), isActiveProduct: () => true }))
vi.mock('../../data/hooks/usePricing', () => ({ usePricing: () => ({ lists: [{ id: 'L1', name: 'General', is_default: true, sort: 1 }, { id: 'L2', name: 'Mayoreo', is_default: false, sort: 2 }], prices: [], priceFor: () => null }) }))
vi.mock('../../data/store/promosStore', () => ({ recargarPromos: vi.fn(async () => {}) }))
beforeEach(cleanup)

const TEXTO = 'Precios de promo allergan\nBotox\n1 pieza $4,000\n5 a 9 piezas $3,800\n10 piezas $3,600\nSkinvive $3,600\nHarmonyCa $6,100\ndel 16 al 25 de octubre'
const PROMO: Promocion = { id: 'P1', nombre: 'Promo allergan', descripcion: null, desde: '2026-10-16', hasta: '2026-10-25', activa: true, listas: null, estado: 'vigente', lineas: [{ product_id: 'B', producto: 'Botox 100 UI', precio_normal: 4600, min_qty: 1, precio: 4000 }], ventas: { pedidos: 3, piezas: 12, importe: 46800 } }

describe('PROMO-2 · Promociones', () => {
  it('empareja nombres del proveedor con el catálogo', () => {
    const prods = [{ id: 'B', name: 'Botox 100 UI' }, { id: 'S', name: 'SkinVive' }, { id: 'H', name: 'HArmonyCa' }]
    expect(emparejarProducto('Botox', prods)).toBe('B'); expect(emparejarProducto('Skinvive', prods)).toBe('S'); expect(emparejarProducto('HarmonyCa', prods)).toBe('H'); expect(emparejarProducto('Juvederm', prods)).toBeNull()
  })
  it('pegar texto → propuesta con productos emparejados → guardar manda la promoción completa por el comando', async () => {
    const guardar = vi.fn(async (d: unknown) => ({ ok: true as const, data: { ...PROMO, ...(d as object) } as Promocion }))
    const listar = vi.fn(async () => ({ ok: true as const, data: [] as Promocion[] }))
    render(<Promociones listar={listar} guardar={guardar} />)
    await waitFor(() => expect(listar).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('promo-pegar'))
    fireEvent.change(screen.getByLabelText('Texto de la promoción'), { target: { value: TEXTO } })
    fireEvent.click(screen.getByTestId('promo-proponer'))
    expect(screen.getByTestId('promo-aviso')).toHaveTextContent(/Leí 5 renglones\. Revisa y guarda/)
    expect((screen.getByLabelText('Nombre de la promoción') as HTMLInputElement).value).toBe('Promo allergan')
    expect((screen.getByLabelText('Desde') as HTMLInputElement).value).toBe(new Date().getFullYear() + '-10-16')
    expect((screen.getByLabelText('Producto 1') as HTMLSelectElement).value).toBe('B'); expect((screen.getByLabelText('Cantidad mínima 2') as HTMLInputElement).value).toBe('5'); expect((screen.getByLabelText('Producto 4') as HTMLSelectElement).value).toBe('S')
    fireEvent.click(screen.getByTestId('promo-guardar'))
    await waitFor(() => expect(guardar).toHaveBeenCalledTimes(1))
    const d = guardar.mock.calls[0][0] as { nombre: string; listas: unknown; lineas: unknown[] }
    expect(d.nombre).toBe('Promo allergan'); expect(d.listas).toBeNull(); expect(d.lineas).toHaveLength(5)
    expect(d.lineas).toContainEqual({ product_id: 'B', min_qty: 10, precio: 3600 }); expect(d.lineas).toContainEqual({ product_id: 'H', min_qty: 1, precio: 6100 })
    expect(screen.getByTestId('promo-aviso')).toHaveTextContent(/guardada · vigente del 16 al 25 de oct/)
  })
  it('un renglón sin producto emparejado bloquea el guardado hasta elegirlo; una promo más cara avisa', async () => {
    render(<Promociones listar={async () => ({ ok: true, data: [] })} guardar={vi.fn()} />)
    fireEvent.click(screen.getByTestId('promo-pegar'))
    fireEvent.change(screen.getByLabelText('Texto de la promoción'), { target: { value: 'Promo X\nJuvederm $5,000\nMascarilla GP $900' } })
    fireEvent.click(screen.getByTestId('promo-proponer'))
    expect(screen.getByTestId('promo-aviso')).toHaveTextContent(/1 sin producto emparejado/)
    expect((screen.getByTestId('promo-guardar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Producto 1'), { target: { value: 'H' } })
    expect((screen.getByTestId('promo-guardar') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByTestId('promo-linea-1')).toHaveTextContent(/la promo es más cara: no se aplicará/)   // $900 > $890
  })
  it('la lista muestra estado y vigencia; pausar llama al comando', async () => {
    const cambiarEstado = vi.fn(async () => ({ ok: true as const, data: { ...PROMO, activa: false, estado: 'inactiva' as const } }))
    render(<Promociones listar={async () => ({ ok: true, data: [PROMO] })} cambiarEstado={cambiarEstado} />)
    await waitFor(() => expect(screen.getByTestId('promo-P1')).toBeInTheDocument())
    expect(screen.getByTestId('promo-P1')).toHaveTextContent(/Vigente/); expect(screen.getByTestId('promo-P1')).toHaveTextContent(/del 16 al 25 de oct · todas las listas/)
    expect(screen.getByTestId('promo-P1')).toHaveTextContent(/Botox 100 UI/); expect(screen.getByTestId('promo-P1')).toHaveTextContent(/\$4,000/)
    expect(screen.getByTestId('promo-ventas-P1')).toHaveTextContent(/3 pedidos · 12 pzas · \$46,800/)   // PROMO-3 · lo vendido con la promo
    fireEvent.click(screen.getByTestId('promo-pausar-P1'))
    await waitFor(() => expect(cambiarEstado).toHaveBeenCalledWith('P1', false))
  })
})

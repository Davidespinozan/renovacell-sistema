// @vitest-environment jsdom
// COMPRAS · NIVELES POR PRODUCTO Y COMPRAR SIEMPRE (27 nov 2026, dueño: «Dirección no puede ajustar el inventario sugerido,
// y si el stock es suficiente le impide comprar más; eso está mal»).
//   Antes: «Bajo» con 20 o menos y sugerir hasta 60, iguales para todo; el botón de comprar solo salía en los «Bajos» y
//   desaparecía si ya había una compra en camino.
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ role: 'admin', compras: [] as unknown[], crear: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: h.role, user: { name: 'Dirección' } }), useRoleOpcional: () => ({ role: h.role, screen: 'compras', capabilities: [] }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [
  { id: 'p-bajo', name: 'Producto bajo', price: 100, unit: null }, { id: 'p-ok', name: 'Producto con existencia', price: 100, unit: null },
  { id: 'p-camino', name: 'Producto en camino', price: 100, unit: null }, { id: 'p-caja', name: 'Producto por caja', price: 100, unit: 'Media caja/10 viales' },
] }) }))
vi.mock('../../data/hooks/useLots', () => ({ useLots: () => ({ data: [
  { id: 'l1', product_id: 'p-bajo', quantity: 8, expiry_date: '2099-12-31', lot_code: 'A' }, { id: 'l2', product_id: 'p-ok', quantity: 45, expiry_date: '2099-12-31', lot_code: 'B' },
  { id: 'l3', product_id: 'p-camino', quantity: 5, expiry_date: '2099-12-31', lot_code: 'C' }, { id: 'l4', product_id: 'p-caja', quantity: 90, expiry_date: '2099-12-31', lot_code: 'D' },
] }) }))
vi.mock('../../data/hooks/useCompras', () => ({ useCompras: () => ({ data: h.compras, createReplenishment: h.crear, markPaid: vi.fn() }) }))
vi.mock('../../app/GuiaInventario', () => ({ GuiaInventario: () => null }))
import { Reabastecimiento } from './Reabastecimiento'
import { nivelDe, sugeridoDeCompra, errorDeNivel } from '../../data/ops/stock'
import { cargarNiveles, guardarNivel, mensajeDeNivel, _reiniciarNiveles } from '../../data/store/nivelesStockStore'

const fila = (id: string) => screen.getByTestId(`fila-stock-${id}`)
beforeEach(() => {
  cleanup(); _reiniciarNiveles(); h.role = 'admin'; h.crear.mockClear()
  h.compras = [{ id: 'c1', product_id: 'p-camino', product_name: 'Producto en camino', qty: 30, received_qty: 10, unit_cost: 50, kind: 'compra', supplier: 'Proveedor', status: 'parcial', paid: false, created_at: '2026-11-25T10:00:00Z' }]
})

describe('las reglas de los niveles', () => {
  it('sin nivel propio aplica el general (20 y 60); con nivel propio, el suyo', () => {
    expect(nivelDe({}, 'x')).toEqual({ minimo: 20, ideal: 60, propio: false })
    expect(nivelDe({ x: { minimo: 50, ideal: 300 } }, 'x')).toEqual({ minimo: 50, ideal: 300, propio: true })
    expect(nivelDe({ x: { minimo: 80, ideal: 10 } }, 'x').propio).toBe(false)                // un nivel imposible no se usa
  })
  it('lo sugerido es lo que falta para el ideal, menos lo que ya viene en camino, y nunca negativo', () => {
    expect(sugeridoDeCompra(8, { ideal: 60 })).toBe(52); expect(sugeridoDeCompra(5, { ideal: 60 }, 20)).toBe(35)
    expect(sugeridoDeCompra(45, { ideal: 300 })).toBe(255); expect(sugeridoDeCompra(70, { ideal: 60 })).toBe(0); expect(sugeridoDeCompra(10, { ideal: 60 }, 80)).toBe(0)
  })
  it('valida igual que el servidor', () => {
    expect(errorDeNivel(20, 60)).toBeNull(); expect(errorDeNivel(0, 1)).toBeNull()
    expect(errorDeNivel(80, 50)).toBe('El ideal no puede ser menor que el mínimo.'); expect(errorDeNivel(-1, 5)).toMatch(/negativo/)
    expect(errorDeNivel(NaN, 5)).toMatch(/dos valores/); expect(errorDeNivel(2.5, 5)).toMatch(/enteros/); expect(errorDeNivel(1, 0)).toMatch(/1 a 1,000,000/)
  })
  it('guarda por la orden del servidor y solo cambia la pantalla si la aceptó; el rechazo llega en palabras', async () => {
    const ok = vi.fn(async () => ({ data: {}, error: null }))
    expect(await guardarNivel('p1', { minimo: 5, ideal: 150 }, ok)).toEqual({ ok: true })
    expect(ok).toHaveBeenCalledWith('stock_nivel_guardar', { p_product: 'p1', p_minimo: 5, p_ideal: 150 })
    expect(await guardarNivel('p1', null, ok)).toEqual({ ok: true }); expect(ok).toHaveBeenLastCalledWith('stock_nivel_guardar', { p_product: 'p1', p_minimo: null, p_ideal: null })
    const no = vi.fn(async () => ({ data: null, error: { message: 'NO_AUTORIZADO: solo Dirección ajusta los niveles de inventario' } }))
    expect(await guardarNivel('p2', { minimo: 1, ideal: 2 }, no)).toEqual({ ok: false, error: 'Solo Dirección ajusta los niveles de inventario' })
    expect(await guardarNivel('p2', { minimo: 9, ideal: 2 }, ok)).toEqual({ ok: false, error: 'El ideal no puede ser menor que el mínimo.' })   // ni sale al servidor
    expect(mensajeDeNivel('')).toMatch(/No se pudieron guardar/)
    expect(await cargarNiveles(async () => ({ data: [{ product_id: 'a', minimo: 3, ideal: 9 }, { product_id: 7 }], error: null }))).toBe(true)
    expect(await cargarNiveles(async () => ({ data: null, error: { message: 'x' } }))).toBe(false)
  })
})

describe('<Reabastecimiento> · siempre se puede comprar', () => {
  it('con existencia suficiente Dirección también puede comprar (antes no había botón)', () => {
    render(<Reabastecimiento />)
    const f = fila('p-ok')
    expect(f).toHaveTextContent('Suficiente')
    fireEvent.click(within(f).getByTestId('btn-comprar'))
    const m = screen.getByTestId('comprar-modal')
    expect(within(m).getByTestId('comprar-contexto')).toHaveTextContent('Tiene existencia suficiente; puedes comprar más si lo necesitas.')
    expect((within(m).getByLabelText('Cantidad') as HTMLInputElement).value).toBe('')      // sin sugerencia: la cantidad se escribe
  })
  it('con una compra en camino dice cuánto viene y deja «Comprar más» (antes solo decía «pendiente de recibir»)', () => {
    render(<Reabastecimiento />)
    const f = fila('p-camino')
    expect(within(f).getByTestId('pill-en-camino')).toHaveTextContent('En camino: 20')
    expect(within(f).getByTestId('btn-comprar')).toHaveTextContent('Comprar más')
    expect(within(f).getByTestId('celda-sugerido')).toHaveTextContent('+35')               // 60 ideal − 5 que hay − 20 que vienen
    fireEvent.click(within(f).getByTestId('btn-comprar'))
    expect(screen.getByTestId('comprar-contexto')).toHaveTextContent('Hay 5 u y vienen 20 u en camino.')
    expect((screen.getByLabelText('Cantidad') as HTMLInputElement).value).toBe('35')
  })
  it('el producto bajo sugiere lo que falta para su ideal y registra la compra con la cantidad que se escriba', async () => {
    render(<Reabastecimiento />)
    const f = fila('p-bajo')
    expect(f).toHaveTextContent('Bajo'); expect(within(f).getByTestId('celda-sugerido')).toHaveTextContent('+52')
    fireEvent.click(within(f).getByTestId('btn-comprar'))
    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Proveedor Uno' } })
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '500' } })      // más de lo sugerido: se permite
    fireEvent.change(screen.getByLabelText('Costo unitario'), { target: { value: '40' } })
    fireEvent.click(screen.getByTestId('comprar-confirmar'))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1))
    expect((h.crear.mock.calls[0] as unknown[])[0]).toMatchObject({ product_id: 'p-bajo', qty: 500, unit_cost: 40, kind: 'compra', supplier: 'Proveedor Uno' })
  })
  it('Almacén ve los niveles y lo que viene en camino, pero no compra ni ajusta', () => {
    h.role = 'warehouse'
    render(<Reabastecimiento />)
    expect(screen.queryByTestId('btn-comprar')).toBeNull(); expect(screen.queryByTestId('btn-niveles')).toBeNull()
    expect(within(fila('p-ok')).getByTestId('celda-niveles')).toHaveTextContent('20 · 60')
    expect(within(fila('p-camino')).getByTestId('pill-en-camino')).toBeInTheDocument()
    expect(fila('p-bajo')).toHaveTextContent('Lo compra Dirección')
  })
})

describe('<Reabastecimiento> · Dirección ajusta los niveles de cada producto', () => {
  it('subir el mínimo vuelve «Bajo» un producto que estaba «Suficiente» y cambia lo sugerido', async () => {
    render(<Reabastecimiento />)
    const f = fila('p-ok')
    expect(within(f).getByTestId('celda-niveles')).toHaveTextContent('20 · 60'); expect(within(f).getByTestId('celda-sugerido')).toHaveTextContent('—')
    fireEvent.click(within(f).getByTestId('btn-niveles'))
    const m = screen.getByTestId('niveles-modal')
    expect(m).toHaveTextContent('No impiden comprar')
    fireEvent.change(within(m).getByLabelText('Mínimo'), { target: { value: '50' } })
    fireEvent.change(within(m).getByLabelText('Ideal'), { target: { value: '300' } })
    fireEvent.click(within(m).getByTestId('niveles-guardar'))
    await waitFor(() => expect(screen.queryByTestId('niveles-modal')).toBeNull())
    expect(within(fila('p-ok')).getByTestId('celda-niveles')).toHaveTextContent('50 · 300')
    expect(fila('p-ok')).toHaveTextContent('Bajo'); expect(within(fila('p-ok')).getByTestId('celda-sugerido')).toHaveTextContent('+255')
    expect(screen.getByRole('status')).toHaveTextContent('avisa con 50 o menos y sugiere reponer hasta 300')
    expect(within(fila('p-bajo')).getByTestId('celda-niveles')).toHaveTextContent('20 · 60')   // los demás no cambian
  })
  it('no deja guardar un ideal menor que el mínimo, y «Usar el nivel general» lo regresa a 20 y 60', async () => {
    await guardarNivel('p-ok', { minimo: 50, ideal: 300 })
    render(<Reabastecimiento />)
    fireEvent.click(within(fila('p-ok')).getByTestId('btn-niveles'))
    fireEvent.change(screen.getByLabelText('Ideal'), { target: { value: '10' } })
    expect(screen.getByTestId('niveles-error')).toHaveTextContent('El ideal no puede ser menor que el mínimo.')
    expect(screen.getByTestId('niveles-guardar')).toBeDisabled()
    fireEvent.click(screen.getByTestId('niveles-general'))
    await waitFor(() => expect(screen.queryByTestId('niveles-modal')).toBeNull())
    expect(within(fila('p-ok')).getByTestId('celda-niveles')).toHaveTextContent('20 · 60'); expect(fila('p-ok')).toHaveTextContent('Suficiente')
  })
  it('en media caja los niveles se escriben en cajas y se guardan en unidades internas', async () => {
    render(<Reabastecimiento />)
    expect(within(fila('p-caja')).getByTestId('celda-niveles')).toHaveTextContent('10 cajas · 30 cajas')
    fireEvent.click(within(fila('p-caja')).getByTestId('btn-niveles'))
    expect((screen.getByLabelText('Mínimo') as HTMLInputElement).value).toBe('10')
    fireEvent.change(screen.getByLabelText('Mínimo'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Ideal'), { target: { value: '80' } })
    fireEvent.click(screen.getByTestId('niveles-guardar'))
    await waitFor(() => expect(screen.queryByTestId('niveles-modal')).toBeNull())
    expect(within(fila('p-caja')).getByTestId('celda-niveles')).toHaveTextContent('50 cajas · 80 cajas')
    expect(fila('p-caja')).toHaveTextContent('Bajo')                                         // 45 cajas ≤ 50
  })
})

describe('dónde se guardan y quién puede', () => {
  const sql = readFileSync(resolve(__dirname, '../../../../../supabase/migrations/20270408090000_stock_niveles.sql'), 'utf8')
  it('van en la tabla privada de costos, nunca en la columna del producto que se publica en el sitio', () => {
    const cuerpo = sql.slice(sql.indexOf('create function public.stock_niveles()'))
    expect(cuerpo).toContain('insert into public.product_costs (product_id, metadata)'); expect(cuerpo).not.toMatch(/update public\.products/)
    expect(cuerpo).not.toContain('unit_cost')                                               // ni se lee ni se toca el costo
  })
  it('solo Dirección guarda; lee el personal de inventario; sin sesión nada', () => {
    expect(sql).toContain("public.auth_role() is distinct from 'admin' then raise exception 'NO_AUTORIZADO")
    expect(sql).toContain("public.auth_role() in ('admin', 'billing', 'warehouse', 'packing')")
    expect(sql).toContain('revoke all on function public.stock_niveles() from public, anon'); expect(sql).toContain('revoke all on function public.stock_nivel_guardar(uuid, integer, integer) from public, anon')
    expect(sql).not.toMatch(/create table|alter table|create index/i)                       // solo funciones
  })
})

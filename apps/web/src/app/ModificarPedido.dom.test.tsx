// @vitest-environment jsdom
// MODIFICAR PEDIDO (27 nov 2026, dueño: «hay que poder hacer modificaciones, agregar productos, etc., cuando el producto
// aún no ha salido a almacén»).
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'

vi.mock('../data/hooks/useProducts', () => ({
  useProducts: () => ({ data: [
    { id: 'p1', name: 'Linurase 100 UI', price: 1800, unit: null, active: true, sellable: true, sku: 'TOX-1' },
    { id: 'p2', name: 'Golden Serum', price: 900, unit: null, active: true, sellable: true, sku: 'GS-1' },
    { id: 'p3', name: 'Ultrafiltrados UFS', price: 3180, unit: 'Media caja/10 viales', active: true, sellable: true, sku: 'UF-1' },
  ] }),
  isActiveProduct: (p: { active?: boolean }) => p.active !== false,
}))
vi.mock('../data/store/ordersStore', () => ({ reloadOrders: vi.fn() }))
import { BotonModificarPedido } from './ModificarPedido'
import { modificarPedido, pedidoModificable } from '../data/ops/modificarPedido'

const pedido = (x: Record<string, unknown> = {}) => ({ id: 'o1', external_ref: 'S602943', status: 'pending_payment', payment_status: 'pending', total: 6400, shipping_cost: 1000, shipping_meta: {},
  items: [{ id: 'i1', product_id: 'p1', qty: 3, unit_price: 1800, lot_id: null }], ...x }) as never
const exito = { ok: true as const, data: { folio: 'S602943', total_antes: 6400, total: 8200, subtotal: 8200, envio_antes: 1000, envio: 0, estado_pago: 'pending' } }
beforeEach(cleanup)

describe('cuándo se ofrece', () => {
  it('solo mientras el pedido no se prepara ni sale; nunca en mostrador', () => {
    expect(pedidoModificable(pedido())).toBe(true)
    expect(pedidoModificable(pedido({ status: 'paid' }))).toBe(true)
    for (const s of ['packed', 'shipped', 'delivered', 'cancelled']) expect(pedidoModificable(pedido({ status: s }))).toBe(false)
    expect(pedidoModificable(pedido({ shipping_meta: { channel: 'pos' } }))).toBe(false)
    expect(pedidoModificable(pedido({ items: [{ id: 'i1', product_id: 'p1', qty: 3, unit_price: 1800, lot_id: 'L1' }] }))).toBe(false)   // ya surtido
  })
  it('en un pedido preparado no aparece el botón', () => {
    render(<BotonModificarPedido order={pedido({ status: 'packed' })} />)
    expect(screen.queryByTestId('modificar-pedido-abrir')).toBeNull()
  })
})

describe('modificarPedido', () => {
  it('manda solo los renglones con cantidad, y el motivo', async () => {
    const rpc = vi.fn(async () => ({ data: { total_antes: 6400, total: 8200 }, error: null }))
    await modificarPedido('o1', [{ product_id: 'p1', qty: 3 }, { product_id: 'p2', qty: 2 }, { product_id: 'p3', qty: 0 }], ' cliente agregó ', rpc)
    expect(rpc).toHaveBeenCalledWith('pedido_modificar', { p_order: 'o1', p_lines: [{ product_id: 'p1', qty: 3 }, { product_id: 'p2', qty: 2 }], p_motivo: 'cliente agregó' })
  })
  it('sin productos o sin motivo no llama al servidor; el rechazo llega en palabras', async () => {
    const rpc = vi.fn()
    expect(await modificarPedido('o1', [{ product_id: 'p1', qty: 0 }], 'x', rpc)).toMatchObject({ ok: false, error: expect.stringMatching(/al menos un producto/) })
    expect(await modificarPedido('o1', [{ product_id: 'p1', qty: 1 }], ' ', rpc)).toMatchObject({ ok: false, error: expect.stringMatching(/por qué/) })
    expect(rpc).not.toHaveBeenCalled()
    const no = vi.fn(async () => ({ data: null, error: { message: 'PEDIDO_NO_MODIFICABLE: el pedido ya se preparó o ya salió de Almacén' } }))
    expect(await modificarPedido('o1', [{ product_id: 'p1', qty: 1 }], 'motivo', no)).toEqual({ ok: false, error: 'El pedido ya se preparó o ya salió de Almacén' })
  })
})

describe('<BotonModificarPedido>', () => {
  it('cambia cantidad, agrega un producto buscándolo y guarda; dice el total nuevo y el envío', async () => {
    const modificar = vi.fn(async () => exito)
    render(<BotonModificarPedido order={pedido()} modificar={modificar} />)
    fireEvent.click(screen.getByTestId('modificar-pedido-abrir'))
    const m = screen.getByTestId('modificar-pedido')
    expect(within(m).getByTestId('mod-guardar')).toBeDisabled()                      // sin cambios todavía
    fireEvent.click(within(within(m).getByTestId('mod-fila-p1')).getByTestId('mod-mas'))
    fireEvent.change(within(m).getByTestId('mod-buscar'), { target: { value: 'golden' } })
    fireEvent.click(within(m).getByTestId('mod-agregar-p2'))
    expect(within(m).getByTestId('mod-fila-p2')).toHaveTextContent('Nuevo')
    expect(within(m).getByTestId('mod-estimado')).toHaveTextContent('$8,100')       // 4 × 1,800 + 1 × 900
    fireEvent.change(within(m).getByTestId('mod-motivo'), { target: { value: 'el cliente agregó producto' } })
    fireEvent.click(within(m).getByTestId('mod-guardar'))
    await waitFor(() => expect(screen.queryByTestId('modificar-pedido')).toBeNull())
    expect(modificar).toHaveBeenCalledWith('o1', [{ product_id: 'p1', qty: 4 }, { product_id: 'p2', qty: 1 }], 'el cliente agregó producto')
    expect(screen.getByTestId('modificar-pedido-hecho')).toHaveTextContent('Total $6,400 → $8,200 · envío $1,000 → $0')
  })
  it('en media caja se edita en cajas y viaja en medias', async () => {
    const modificar = vi.fn(async () => exito)
    render(<BotonModificarPedido order={pedido({ items: [{ id: 'i1', product_id: 'p3', qty: 4, unit_price: 3180, lot_id: null }] })} modificar={modificar} />)
    fireEvent.click(screen.getByTestId('modificar-pedido-abrir'))
    const fila = screen.getByTestId('mod-fila-p3')
    expect((within(fila).getByTestId('mod-cantidad') as HTMLInputElement).value).toBe('2')   // 4 medias = 2 cajas
    fireEvent.click(within(fila).getByTestId('mod-mas'))                                     // + media caja
    fireEvent.change(screen.getByTestId('mod-motivo'), { target: { value: 'media caja más' } })
    fireEvent.click(screen.getByTestId('mod-guardar'))
    await waitFor(() => expect(modificar).toHaveBeenCalled())
    expect(modificar).toHaveBeenCalledWith('o1', [{ product_id: 'p3', qty: 5 }], 'media caja más')
  })
  it('si el servidor no deja, lo dice y la ventana sigue abierta', async () => {
    render(<BotonModificarPedido order={pedido()} modificar={async () => ({ ok: false, error: 'Tiene un link de pago con tarjeta abierto; cancélalo primero (el monto cambiaría)' })} />)
    fireEvent.click(screen.getByTestId('modificar-pedido-abrir'))
    fireEvent.click(screen.getByTestId('mod-quitar'))
    fireEvent.change(screen.getByTestId('mod-buscar'), { target: { value: 'serum' } }); fireEvent.click(screen.getByTestId('mod-agregar-p2'))
    fireEvent.change(screen.getByTestId('mod-motivo'), { target: { value: 'cambio de producto' } })
    fireEvent.click(screen.getByTestId('mod-guardar'))
    expect(await screen.findByTestId('mod-error')).toHaveTextContent('link de pago con tarjeta abierto')
    expect(screen.getByTestId('modificar-pedido')).toBeTruthy()
  })
})

describe('la orden del servidor', () => {
  const sql = readFileSync(resolve(__dirname, '../../../../supabase/migrations/20270408110000_pedido_modificar.sql'), 'utf8')
  it('se niega si ya salió de Almacén, si hay inventario sacado, guía, link abierto o factura timbrada', () => {
    for (const s of ["o.status in ('packed', 'shipped', 'delivered', 'fulfilled')", 'from public.inventory_movements m where m.order_id = p_order', 'from public.shipments s where s.order_id = p_order',
      "l.estado = 'solicitado'", "f.status in ('en_proceso', 'incierto', 'timbrado')"]) expect(sql).toContain(s)
  })
  it('mismos precios que al crear, nunca sube lo que ya estaba, y deja rastro con antes y después', () => {
    expect(sql).toContain('public.precio_de(pid, v_list, q, coalesce((v_vq ->> pid::text)::int, q))')
    expect(sql).toContain('select least(up, min(i.unit_price))')
    expect(sql).toContain("public.log_audit('Pedido modificado'"); expect(sql).toContain("'antes', jsonb_build_object('renglones', v_antes")
    expect(sql).toContain('public._w2_recalc_payment_status(p_order)')
    expect(sql).not.toMatch(/create table|alter table|create index/i)
  })
  it('solo Dirección o la vendedora que ve el pedido', () => {
    expect(sql).toContain("v_rol = 'admin' or (v_rol = 'pos' and public._sec_c1_pos_ve_pedido(p_order))")
    expect(sql).toContain('revoke all on function public.pedido_modificar(uuid, jsonb, text) from public, anon')
  })
})

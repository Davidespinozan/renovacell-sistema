// @vitest-environment jsdom
// COTIZACIONES EN INICIO (28 nov 2026, dueño): cotizar no es vender; las que siguen abiertas se ven en Inicio con su
// vencimiento y se vuelven pedido, se mandan por WhatsApp, se extienden o se marcan como no cerradas.
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ user: { name: 'Alejandra' } }) }))
vi.mock('../../app/Toast', () => ({ toast: vi.fn() }))
vi.mock('../../app/dialogos', () => ({ confirmar: vi.fn(async () => true) }))
const nuevoPedido = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('../sales/NuevoPedido', () => ({ NuevoPedido: (p: Record<string, unknown>) => { nuevoPedido.props = p; return <div data-testid="nuevo-pedido" /> } }))
vi.mock('../sales/NuevaCotizacion', () => ({ NuevaCotizacion: () => null }))
vi.mock('../pos/SelectorCliente', () => ({ SelectorClienteVentas: () => null }))
import { CotizacionesPorCerrar } from './CotizacionesInicio'
import { vigenciaCotizacion, carritoDeCotizacion, type CotizacionAbierta } from '../../data/ops/cotizaciones'

const DIA = 86_400_000
const cot = (x: Partial<CotizacionAbierta> = {}): CotizacionAbierta => ({
  id: 'c1', folio: 'COT-0001', customer_id: 'cu1', conversation_id: null, cliente: 'DIANA LAURA VELARDE', telefono: '6672155894', correo: null, total: 6500,
  lineas: [{ product_id: 'p1', nombre: 'Golden Placenta', sku: null, qty: 2, unit_price: 3250, precio_lista: 3250, subtotal: 6500 }], notas: null,
  vigente_hasta: new Date(Date.now() + 5 * DIA).toISOString(), created_at: new Date().toISOString(), enviada_chat_at: null, enviada_correo_at: null, vendedor: 'Alejandra Cázarez', mia: true, ...x })
const clienteFalso = (lista: CotizacionAbierta[]) => ({
  abiertas: vi.fn(async () => ({ ok: true as const, data: lista })), extender: vi.fn(async () => ({ ok: true as const, data: { vigente_hasta: '' } })),
  cancelar: vi.fn(async () => ({ ok: true as const, data: { idempotente: false } })), convertida: vi.fn(async () => ({ ok: true as const, data: { idempotente: false } })),
  enviar: vi.fn(async () => ({ ok: true as const, data: { via: 'chat' } })),
}) as never
beforeEach(() => { cleanup(); nuevoPedido.props = null })

describe('vigencia', () => {
  it('dice en palabras cuánto le queda o cuándo venció', () => {
    const ahora = Date.parse('2026-11-28T12:00:00Z')
    expect(vigenciaCotizacion('2026-12-03T12:00:00Z', ahora)).toMatchObject({ texto: 'vence en 5 días', tono: 'ok', vencida: false })
    expect(vigenciaCotizacion('2026-11-28T20:00:00Z', ahora)).toMatchObject({ texto: 'vence hoy', tono: 'warn' })
    expect(vigenciaCotizacion('2026-11-26T12:00:00Z', ahora)).toMatchObject({ texto: 'venció hace 2 días', tono: 'dang', vencida: true })
  })
  it('el pedido arranca con los mismos productos y cantidades', () => {
    expect(carritoDeCotizacion(cot())).toEqual({ p1: 2 })
  })
})

describe('<CotizacionesPorCerrar>', () => {
  it('sin cotizaciones abiertas no ocupa lugar', async () => {
    const c = clienteFalso([])
    const { container } = render(<CotizacionesPorCerrar cliente={c} />)
    await waitFor(() => expect((c as { abiertas: ReturnType<typeof vi.fn> }).abiertas).toHaveBeenCalled())
    expect(container.querySelector('[data-testid=cot-inicio]')).toBeNull()
  })
  it('muestra cliente, total y vencimiento; «Hacer pedido» abre el pedido con sus productos y lo liga', async () => {
    const c = clienteFalso([cot()])
    render(<CotizacionesPorCerrar cliente={c} equipo />)
    const fila = await screen.findByTestId('cot-inicio-fila')
    expect(fila).toHaveTextContent(/Diana Laura Velarde · \$6,500/)
    expect(fila).toHaveTextContent(/vence en (4|5) días/)
    expect(fila).toHaveTextContent(/aún no se le manda/)
    expect(fila).toHaveTextContent(/Alejandra Cázarez/)   // Dirección ve de quién es
    fireEvent.click(within(fila).getByTestId('cot-inicio-pedido'))
    expect(screen.getByTestId('nuevo-pedido')).toBeTruthy()
    expect(nuevoPedido.props?.initialCart).toEqual({ p1: 2 })
    ;(nuevoPedido.props?.onCreado as (p: { id: string; external_ref: string }) => void)({ id: 'o9', external_ref: 'S900001' })
    await waitFor(() => expect((c as { convertida: ReturnType<typeof vi.fn> }).convertida).toHaveBeenCalledWith('c1', 'o9'))
  })
  it('vencida: no se vuelve pedido hasta darle días; «No se cerró» la saca', async () => {
    const c = clienteFalso([cot({ vigente_hasta: new Date(Date.now() - 2 * DIA).toISOString() })])
    render(<CotizacionesPorCerrar cliente={c} />)
    const fila = await screen.findByTestId('cot-inicio-fila')
    expect(within(fila).getByTestId('cot-inicio-pedido')).toBeDisabled()
    expect(within(fila).queryByTestId('cot-inicio-wa')).toBeNull()
    fireEvent.click(within(fila).getByTestId('cot-inicio-extender'))
    await waitFor(() => expect((c as { extender: ReturnType<typeof vi.fn> }).extender).toHaveBeenCalledWith('c1', 7))
    fireEvent.click(within(fila).getByTestId('cot-inicio-no'))
    await waitFor(() => expect((c as { cancelar: ReturnType<typeof vi.fn> }).cancelar).toHaveBeenCalledWith('c1'))
  })
})

describe('la orden del servidor', () => {
  const sql = readFileSync(resolve(__dirname, '../../../../../supabase/migrations/20270408130000_cotizaciones_seguimiento.sql'), 'utf8')
  it('Dirección y jefe de ventas ven todas; cada vendedora las suyas; solo crea funciones', () => {
    expect(sql).toContain("public.auth_role() = 'admin' or public._jefe_ventas()")
    expect(sql).toContain("(public.auth_role() = 'pos' and (c.seller_profile_id = auth.uid() or c.created_by = auth.uid()))")
    expect(sql).toContain("c.estado = 'enviada' and c.vigente_hasta > now() - interval '15 days'")
    expect(sql).toContain('perform public._cot_exige(r.customer_id)')
    expect(sql).not.toMatch(/create table|alter table|create index/i)
  })
})

// @vitest-environment jsdom
// FILA DEL DÍA (27 nov 2026) · el Inicio de Almacén muestra todo lo que le toca, agrupado por cuándo sale: también lo que
// ya tiene chofer y espera salida, y lo que espera a que el cliente lo recoja (antes esos dos no aparecían en Inicio).
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ orders: [] as unknown[], envios: [] as unknown[], dispatch: vi.fn(), shipped: vi.fn() }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'warehouse', setScreen: vi.fn(), user: { name: 'Alberto', email: 'a@x' } }), useRoleOpcional: () => ({ role: 'warehouse', user: { name: 'Alberto' } }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: h.orders }) }))
vi.mock('../../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: {} }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'p1', name: 'Exosomas' }] }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ data: h.envios, dispatchShipment: h.dispatch, createShipment: vi.fn() }) }))
vi.mock('../logistics/AgendaEntregas', () => ({ useAgendaEntregas: () => ({ data: null, error: null }) }))
vi.mock('../../data/hooks/useCorteEntrega', () => ({ useCorteEntrega: () => '15:30' }))
vi.mock('../../data/store/ordersStore', async (orig) => ({ ...(await orig<typeof import('../../data/store/ordersStore')>()), markShipped: h.shipped }))
import { HoyAlmacen } from './HoyAlmacen'

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const base = (id: string, folio: string, nombre: string) => ({ id, external_ref: folio, doctor_id: null, payment_status: 'paid', total: 1000, created_at: `${HOY}T10:00:00Z`, items: [{ id: 'i' + id, product_id: 'p1', qty: 2, unit_price: 500 }], cliente: nombre })
const meta = (nombre: string, entrega: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({ customer: { name: nombre, phone: '6671234567' }, address: { line1: 'Av. Obregón 1', city: 'Culiacán', phone: '6671234567' }, ...(entrega ? { entrega } : {}), ...extra })
const DHL = { opcion: 'foraneo', tipo: 'foraneo', paqueteria: 'dhl', texto: 'DHL', flete: 0, salida: HOY, llega_desde: HOY, llega_hasta: HOY }
const LOCAL = { opcion: 'local', tipo: 'local', paqueteria: 'chofer', texto: 'Entrega local', flete: 0, salida: HOY, llega_desde: HOY, llega_hasta: HOY, horario: { fecha: HOY, inicio: '16:00', fin: '18:00' } }

beforeEach(() => {
  cleanup(); h.dispatch.mockReset(); h.shipped.mockReset()
  h.orders = [
    { ...base('o1', 'S1', 'Dra. Morales'), status: 'paid', shipping_meta: meta('Dra. Morales', DHL) },
    { ...base('o2', 'S2', 'Dr. Ruiz'), status: 'packed', shipping_meta: meta('Dr. Ruiz', LOCAL) },
    { ...base('o3', 'S3', 'Dr. Vega'), status: 'packed', shipping_meta: meta('Dr. Vega', LOCAL) },
    { ...base('o4', 'S4', 'Dra. Luna'), status: 'shipped', shipping_meta: meta('Dra. Luna', null, { method: 'recoge' }) },
  ]
  h.envios = [{ id: 'e3', order_id: 'o3', driver_id: 'drv-1', status: 'por_despachar', created_at: `${HOY}T11:00:00Z`, carrier: null, tracking_number: null }]
})

describe('<HoyAlmacen> · la fila del día', () => {
  it('agrupa por cuándo sale y con quién, y cada pedido trae el botón de su paso', () => {
    render(<HoyAlmacen />)
    expect(screen.getAllByTestId('hoy-grupo').map((g) => g.textContent)).toEqual([' Sale hoy antes de las 3:30 p.m. · DHL (1)', ' Sale hoy antes de las 4:00 p.m. · chofer (2)'])
    expect(screen.getByTestId('hoy-preparar-o1')).toHaveTextContent('Preparar pedido')
    expect(screen.getByTestId('hoy-enviar-o2')).toHaveTextContent('Entregar al chofer')
    expect(screen.getByTestId('hoy-despachar-o3')).toHaveTextContent('Ya le entregué la carga: despachar')
    expect(within(screen.getByTestId('hoy-caso-o3')).getByTestId('hoy-paso')).toHaveTextContent(/falta darle salida/)
  })

  it('lo que espera a que el cliente lo recoja está en Inicio, con el nombre para tocarlo', () => {
    render(<HoyAlmacen />)
    expect(screen.getByTestId('hoy-grupo-recoger')).toHaveTextContent('Esperan a que el cliente los recoja (1)')
    fireEvent.click(screen.getByTestId('recoger-entregar'))
    fireEvent.click(screen.getByTestId('recoger-sugerido'))
    expect((screen.getByTestId('recoger-quien') as HTMLInputElement).value).toBe('Dra. Luna')
  })

  it('los filtros dicen cuántos hay y dejan ver solo esa parte', () => {
    render(<HoyAlmacen />)
    expect(screen.getByTestId('hoy-filtro-todos')).toHaveTextContent('Todos 4')
    expect(screen.getByTestId('hoy-filtro-preparar')).toHaveTextContent('Por preparar 1')
    expect(screen.getByTestId('hoy-filtro-salir')).toHaveTextContent('Por salir 2')
    expect(screen.getByTestId('hoy-filtro-recoger')).toHaveTextContent('Para recoger 1')
    fireEvent.click(screen.getByTestId('hoy-filtro-salir'))
    expect(screen.queryByTestId('hoy-caso-o1')).toBeNull()
    expect(screen.getByTestId('hoy-caso-o2')).toBeTruthy()
    expect(screen.queryByTestId('hoy-grupo-recoger')).toBeNull()
    fireEvent.click(screen.getByTestId('hoy-filtro-recoger'))
    expect(screen.queryByTestId('hoy-caso-o2')).toBeNull()
    expect(screen.getByTestId('hoy-grupo-recoger')).toBeTruthy()
  })

  it('dar salida desde Inicio despacha el envío y luego pone el pedido En camino', async () => {
    h.dispatch.mockResolvedValue({ ok: true }); h.shipped.mockResolvedValue({ ok: true })
    render(<HoyAlmacen />)
    fireEvent.click(screen.getByTestId('hoy-despachar-o3'))
    await waitFor(() => expect(h.shipped).toHaveBeenCalledWith('o3', expect.objectContaining({ method: 'chofer', driver_id: 'drv-1' })))
    expect(h.dispatch).toHaveBeenCalledWith('e3', 'Alberto', 'S3')
  })

  it('si la salida no quedó, lo dice en ese pedido y no lo pone En camino', async () => {
    h.dispatch.mockResolvedValue({ ok: false, error: 'Sin conexión.', ambiguous: false })
    render(<HoyAlmacen />)
    fireEvent.click(screen.getByTestId('hoy-despachar-o3'))
    await waitFor(() => expect(within(screen.getByTestId('hoy-caso-o3')).getByRole('alert')).toHaveTextContent('NO se despachó. Sin conexión.'))
    expect(h.shipped).not.toHaveBeenCalled()
  })

  it('los números del día siguen ahí, debajo de la fila', () => {
    render(<HoyAlmacen />)
    for (const t of ['hoy-decision', 'hoy-guias', 'hoy-camino']) expect(screen.getByTestId(t)).toBeTruthy()
  })
})

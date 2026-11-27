// @vitest-environment jsdom
// FILA DEL DÍA (27 nov 2026) · el Inicio de Almacén muestra todo lo que le toca, agrupado por cuándo sale: también lo que
// ya tiene chofer y espera salida, y lo que espera a que el cliente lo recoja (antes esos dos no aparecían en Inicio).
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ orders: [] as unknown[], envios: [] as unknown[], dispatch: vi.fn(), shipped: vi.fn(), create: vi.fn(), ancho: true, role: 'warehouse' }))
vi.mock('../../app/useAnchoMinimo', () => ({ useAnchoMinimo: () => h.ancho }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: h.role, setScreen: vi.fn(), user: { name: 'Alberto', email: 'a@x' } }), useRoleOpcional: () => ({ role: h.role, user: { name: 'Alberto' } }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: h.orders }) }))
vi.mock('../../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: {} }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'p1', name: 'Exosomas' }] }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ data: h.envios, dispatchShipment: h.dispatch, createShipment: h.create }) }))
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
  cleanup(); h.dispatch.mockReset(); h.shipped.mockReset(); h.create.mockReset(); h.ancho = true; h.role = 'warehouse'
  try { localStorage.clear() } catch { /* sin almacenamiento */ }
  h.orders = [
    { ...base('o1', 'S1', 'ROCIO UGALDE PEDROZA'), status: 'paid', shipping_meta: meta('ROCIO UGALDE PEDROZA', DHL) },
    { ...base('o2', 'S2', 'Dr. Ruiz'), status: 'packed', shipping_meta: meta('Dr. Ruiz', LOCAL) },
    { ...base('o3', 'S3', 'Dr. Vega'), status: 'packed', shipping_meta: meta('Dr. Vega', LOCAL) },
    { ...base('o4', 'S4', 'Dra. Luna'), status: 'shipped', shipping_meta: meta('Dra. Luna', null, { method: 'recoge' }) },
  ]
  h.envios = [{ id: 'e3', order_id: 'o3', driver_id: 'drv-1', status: 'por_despachar', created_at: `${HOY}T11:00:00Z`, carrier: null, tracking_number: null }]
})

describe('<HoyAlmacen> · lista y detalle (computadora)', () => {
  it('los pedidos van en renglones cortos, agrupados por cuándo salen y con quién', () => {
    render(<HoyAlmacen />)
    expect(screen.getAllByTestId('hoy-grupo').map((g) => g.textContent)).toEqual([' Sale hoy antes de las 3:30 p.m. · DHL (1)', ' Sale hoy antes de las 4:00 p.m. · chofer (2)'])
    const fila = screen.getByTestId('hoy-caso-o1')
    expect(fila).toHaveTextContent('Rocio Ugalde Pedroza')          // el nombre ya no sale en MAYÚSCULAS
    expect(fila).toHaveTextContent('S1 · 1 producto · Culiacán')
    expect(within(fila).getByTestId('hoy-paso')).toHaveTextContent('Por preparar')
    expect(within(screen.getByTestId('hoy-caso-o3')).getByTestId('hoy-paso')).toHaveTextContent('Falta darle salida')
  })

  it('el primero ya viene abierto al lado, con sus productos, su dirección y UN botón', () => {
    render(<HoyAlmacen />)
    const d = screen.getByTestId('hoy-detalle')
    expect(within(d).getByTestId('hoy-detalle-o1')).toHaveTextContent('Productos a empacar')
    expect(d).toHaveTextContent('Av. Obregón 1')
    expect(within(d).getByTestId('hoy-preparar-o1')).toHaveTextContent('Preparar pedido')
    expect(screen.getAllByRole('button', { name: /Preparar pedido/ })).toHaveLength(1)   // ya no se repite en cada pedido
  })

  it('al tocar otro renglón se abre ese pedido con el botón de su paso', () => {
    render(<HoyAlmacen />)
    fireEvent.click(screen.getByTestId('hoy-caso-o2'))
    expect(screen.getByTestId('hoy-enviar-o2')).toHaveTextContent('Entregar al chofer')
    expect(screen.getByTestId('hoy-caso-o2').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('hoy-caso-o3'))
    expect(screen.getByTestId('hoy-despachar-o3')).toHaveTextContent('Ya le entregué la carga: despachar')
    expect(screen.getByTestId('hoy-detalle-o3')).toHaveTextContent(/falta darle salida/)
  })

  it('lo que espera a que el cliente lo recoja está en la lista, con el nombre para tocarlo', () => {
    render(<HoyAlmacen />)
    expect(screen.getByTestId('hoy-grupo-recoger')).toHaveTextContent('Esperan a que el cliente los recoja (1)')
    fireEvent.click(screen.getByTestId('hoy-caso-o4'))
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
    expect(screen.getByTestId('hoy-enviar-o2')).toBeTruthy()      // el detalle sigue al filtro: abre el primero que quedó
    expect(screen.queryByTestId('hoy-grupo-recoger')).toBeNull()
    fireEvent.click(screen.getByTestId('hoy-filtro-recoger'))
    expect(screen.queryByTestId('hoy-caso-o2')).toBeNull()
    expect(screen.getByTestId('hoy-grupo-recoger')).toBeTruthy()
  })

  it('dar salida desde el detalle despacha el envío y luego pone el pedido En camino', async () => {
    h.dispatch.mockResolvedValue({ ok: true }); h.shipped.mockResolvedValue({ ok: true })
    render(<HoyAlmacen />)
    fireEvent.click(screen.getByTestId('hoy-caso-o3'))
    fireEvent.click(screen.getByTestId('hoy-despachar-o3'))
    await waitFor(() => expect(h.shipped).toHaveBeenCalledWith('o3', expect.objectContaining({ method: 'chofer', driver_id: 'drv-1' })))
    expect(h.dispatch).toHaveBeenCalledWith('e3', 'Alberto', 'S3')
  })

  it('si la salida no quedó, lo dice en ese pedido y no lo pone En camino', async () => {
    h.dispatch.mockResolvedValue({ ok: false, error: 'Sin conexión.', ambiguous: false })
    render(<HoyAlmacen />)
    fireEvent.click(screen.getByTestId('hoy-caso-o3'))
    fireEvent.click(screen.getByTestId('hoy-despachar-o3'))
    await waitFor(() => expect(within(screen.getByTestId('hoy-detalle-o3')).getByRole('alert')).toHaveTextContent('NO se despachó. Sin conexión.'))
    expect(h.shipped).not.toHaveBeenCalled()
  })

  it('un solo aviso dice cuántos van atrasados, y se pueden ver solo esos', () => {
    const antier = new Date(new Date(HOY + 'T12:00:00Z').getTime() - 2 * 86_400_000).toISOString().slice(0, 10)
    h.orders = [...h.orders, { ...base('o9', 'S9', 'Dr. Peña'), status: 'paid', shipping_meta: meta('Dr. Peña', { ...DHL, salida: antier, llega_desde: antier, llega_hasta: antier }) }]
    render(<HoyAlmacen />)
    expect(screen.getByTestId('hoy-atraso')).toHaveTextContent('1 pedido ya pasó su fecha de salida.')
    expect(screen.getByTestId('hoy-filtro-atrasados')).toHaveTextContent('Atrasados 1')
    // los atrasados van en un solo grupo y cada renglón dice cuándo debió salir y con quién
    expect(screen.getAllByTestId('hoy-grupo')[0]).toHaveTextContent('Ya pasó su fecha de salida (1)')
    expect(screen.getByTestId('hoy-caso-o9')).toHaveTextContent(/Debió salir el \d\d\/\d\d · DHL/)
    fireEvent.click(screen.getByTestId('hoy-atraso-ver'))
    expect(screen.getByTestId('hoy-caso-o9')).toBeTruthy()
    expect(screen.queryByTestId('hoy-caso-o1')).toBeNull()
    expect(screen.queryByTestId('hoy-atraso')).toBeNull()
  })

  it('sin atrasados no hay aviso ni filtro de atrasados', () => {
    render(<HoyAlmacen />)
    expect(screen.queryByTestId('hoy-atraso')).toBeNull()
    expect(screen.queryByTestId('hoy-filtro-atrasados')).toBeNull()
  })

  it('los números del día siguen ahí, debajo de la fila', () => {
    render(<HoyAlmacen />)
    for (const t of ['hoy-decision', 'hoy-guias', 'hoy-camino']) expect(screen.getByTestId(t)).toBeTruthy()
  })
})

describe('<HoyAlmacen> · entregar varios al chofer de una vez', () => {
  const dosLocales = () => {
    h.orders = [
      { ...base('o2', 'S2', 'DR. RUIZ'), status: 'packed', shipping_meta: meta('DR. RUIZ', LOCAL) },
      { ...base('o6', 'S6', 'Dra. Paz'), status: 'packed', shipping_meta: meta('Dra. Paz', LOCAL) },
      { ...base('o1', 'S1', 'Dr. Foráneo'), status: 'packed', shipping_meta: meta('Dr. Foráneo', DHL) },
    ]
    h.envios = []
    h.create.mockImplementation(async (x: { order_id: string }) => ({ ok: true, shipment: { id: 'e-' + x.order_id } }))
    h.dispatch.mockResolvedValue({ ok: true }); h.shipped.mockResolvedValue({ ok: true })
  }
  it('con dos locales preparados en la misma salida aparece UN botón; los de paquetería no entran', () => {
    dosLocales()
    render(<HoyAlmacen />)
    const botones = screen.getAllByTestId('hoy-lote')
    expect(botones).toHaveLength(1)
    expect(botones[0]).toHaveTextContent('Entregar los 2 al chofer')
    fireEvent.click(botones[0])
    const hoja = screen.getByTestId('lote')
    expect(hoja).toHaveTextContent('Dr. Ruiz'); expect(hoja).toHaveTextContent('Dra. Paz'); expect(hoja).not.toHaveTextContent('Dr. Foráneo')
  })
  it('sin chofer elegido el botón dice qué falta; al elegirlo entrega los dos con los tres pasos de siempre', async () => {
    dosLocales()
    render(<HoyAlmacen />)
    fireEvent.click(screen.getByTestId('hoy-lote'))
    expect(screen.getByTestId('lote-falta')).toHaveTextContent('Falta elegir al chofer')
    expect((screen.getByTestId('lote-entregar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('lote-chofer'), { target: { value: 'drv-1' } })
    expect(screen.getByTestId('lote-entregar')).toHaveTextContent('Entregar los 2 a Beto')
    fireEvent.click(screen.getByTestId('lote-entregar'))
    await waitFor(() => expect(screen.getByTestId('lote-resultado')).toHaveTextContent('Los 2 pedidos ya van En camino con Beto'))
    expect(h.create).toHaveBeenCalledTimes(2)
    expect(h.create.mock.calls[0][0]).toMatchObject({ order_id: 'o2', driver_id: 'drv-1', status: 'por_despachar', carrier: null })
    expect(h.dispatch).toHaveBeenCalledWith('e-o2', 'Alberto', 'S2'); expect(h.dispatch).toHaveBeenCalledWith('e-o6', 'Alberto', 'S6')
    expect(h.shipped).toHaveBeenCalledWith('o6', { method: 'chofer', driver: 'Beto · Chofer', driver_id: 'drv-1' })
    expect(localStorage.getItem('rc_ultimo_chofer')).toBe('drv-1')             // la próxima vez ya viene elegido
    fireEvent.click(screen.getByTestId('lote-listo'))
    expect(screen.queryByTestId('lote')).toBeNull()
  })
  it('si uno falla, dice cuál y por qué; el otro sí sale', async () => {
    dosLocales()
    h.dispatch.mockImplementation(async (envio: string) => (envio === 'e-o2' ? { ok: false, error: 'Sin conexión.' } : { ok: true }))
    render(<HoyAlmacen />)
    fireEvent.click(screen.getByTestId('hoy-lote'))
    fireEvent.change(screen.getByTestId('lote-chofer'), { target: { value: 'drv-2' } })
    fireEvent.click(screen.getByTestId('lote-entregar'))
    await waitFor(() => expect(screen.getByTestId('lote-resultado')).toHaveTextContent('1 de 2 quedaron En camino'))
    expect(screen.getByTestId('lote-pedido-o2')).toHaveTextContent('Quedó asignado, pero NO salió. Sin conexión.')
    expect(screen.getByTestId('lote-pedido-o6')).toHaveTextContent('En camino')
    expect(h.shipped).toHaveBeenCalledTimes(1)
  })
  it('con un solo local preparado no hay botón de lote: se usa el de siempre', () => {
    dosLocales(); h.orders = (h.orders as Array<{ id: string }>).filter((o) => o.id !== 'o6')
    render(<HoyAlmacen />)
    expect(screen.queryByTestId('hoy-lote')).toBeNull()
  })
})

describe('<HoyAlmacen> · auxiliar de almacén', () => {
  it('en un pedido de paquetería ya preparado no ve un botón que no es suyo: ve a quién le toca', () => {
    h.role = 'packing'
    h.orders = [
      { ...base('o5', 'S5', 'Dra. Paz'), status: 'packed', shipping_meta: meta('Dra. Paz', DHL) },
      { ...base('o2', 'S2', 'Dr. Ruiz'), status: 'packed', shipping_meta: meta('Dr. Ruiz', LOCAL) },
    ]
    h.envios = []
    render(<HoyAlmacen />)
    expect(within(screen.getByTestId('hoy-caso-o5')).getByTestId('hoy-paso')).toHaveTextContent('Espera la guía')
    fireEvent.click(screen.getByTestId('hoy-caso-o5'))
    expect(screen.getByTestId('hoy-le-toca-o5')).toHaveTextContent('Le toca a Alberto: generar la guía')
    expect(screen.queryByTestId('hoy-enviar-o5')).toBeNull()
    fireEvent.click(screen.getByTestId('hoy-caso-o2'))                 // el de chofer sí es suyo: conserva su botón
    expect(screen.getByTestId('hoy-enviar-o2')).toBeTruthy()
    expect(screen.queryByTestId('hoy-le-toca-o2')).toBeNull()
  })
  it('a Almacén (Alberto) le sigue saliendo su botón en ese mismo pedido', () => {
    h.orders = [{ ...base('o5', 'S5', 'Dra. Paz'), status: 'packed', shipping_meta: meta('Dra. Paz', DHL) }]
    h.envios = []
    render(<HoyAlmacen />)
    expect(screen.getByTestId('hoy-enviar-o5')).toBeTruthy()
    expect(screen.queryByTestId('hoy-le-toca-o5')).toBeNull()
  })
})

describe('<HoyAlmacen> · en el celular', () => {
  it('solo se ve la lista; al tocar un pedido se abre en una hoja con su botón', () => {
    h.ancho = false
    render(<HoyAlmacen />)
    expect(screen.queryByTestId('hoy-detalle')).toBeNull()
    expect(screen.queryByTestId('hoy-hoja')).toBeNull()
    expect(screen.queryByTestId('hoy-atraso')).toBeNull()
    fireEvent.click(screen.getByTestId('hoy-caso-o2'))
    const hoja = screen.getByTestId('hoy-hoja')
    expect(within(hoja).getByTestId('hoy-detalle-o2')).toHaveTextContent('Productos a empacar')
    expect(within(hoja).getByTestId('hoy-enviar-o2')).toHaveTextContent('Entregar al chofer')
  })
  it('al tocar el botón la hoja se cierra y se abre la ventana de ese paso (no se enciman)', () => {
    h.ancho = false
    render(<HoyAlmacen />)
    fireEvent.click(screen.getByTestId('hoy-caso-o2'))
    fireEvent.click(screen.getByTestId('hoy-enviar-o2'))
    expect(screen.queryByTestId('hoy-hoja')).toBeNull()
    expect(screen.getByRole('heading', { name: /Entregar al chofer · S2/ })).toBeTruthy()
  })
})

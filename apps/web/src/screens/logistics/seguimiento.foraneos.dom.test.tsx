// @vitest-environment jsdom
// SEGUIMIENTO COMPLETO (27 nov 2026, dueño: «¿por qué en Envíos nada más se pueden ver las entregas locales en Dirección?
// ¿no tienen manera de ver trazabilidad de envíos foráneos?»). La pantalla solo listaba pedidos ya preparados: los
// foráneos pagados que seguían en Almacén sin guía no aparecían y Dirección veía únicamente las entregas del chofer.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ orders: [] as unknown[], envios: [] as unknown[], role: 'admin', money: {} as Record<string, { liberado: boolean }> }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: h.role, setScreen: vi.fn(), user: { name: 'Dirección', email: 'd@x' } }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: h.orders }) }))
vi.mock('../../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: h.money }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'p1', name: 'Linurase 100 UI', unit: null }] }) }))
vi.mock('../../data/hooks/useDoctors', () => ({ useDoctors: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ data: h.envios, resolveIncident: vi.fn(), regresarAlAlmacen: vi.fn(), cambiarChofer: vi.fn() }) }))
vi.mock('../../data/hooks/useCorteEntrega', () => ({ useCorteEntrega: () => '15:30' }))
vi.mock('../../data/hooks/useRastreo', () => ({ useRastreo: () => ({ rastreo: null, cargando: false, actualizar: vi.fn() }) }))
import { Seguimiento } from './Seguimiento'

const dia = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const HOY = dia(new Date())
const AYER = dia(new Date(Date.now() - 36 * 3600_000))
const meta = (nombre: string, entrega: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({ customer: { name: nombre, phone: '6671234567' }, address: { line1: 'Av. Reforma 10', city: 'Guadalajara' }, ...(entrega ? { entrega } : {}), ...extra })
const FOR = (paq: string, salida = HOY) => ({ opcion: 'foraneo', tipo: 'foraneo', paqueteria: paq, texto: paq, flete: 0, salida, llega_desde: salida, llega_hasta: salida })
const LOCAL = { opcion: 'local', tipo: 'local', paqueteria: 'chofer', texto: 'Entrega local', flete: 0, salida: HOY, llega_desde: HOY, llega_hasta: HOY, horario: { fecha: HOY, inicio: '16:00', fin: '18:00' } }
const ped = (id: string, folio: string, status: string, shipping_meta: unknown, x: Record<string, unknown> = {}) => ({ id, external_ref: folio, doctor_id: null, payment_status: 'paid', status, total: 1000, created_at: `${HOY}T1${id.slice(-1)}:00:00Z`, items: [{ id: 'i' + id, product_id: 'p1', qty: 1, unit_price: 1000 }], shipping_meta, ...x })
const folios = () => screen.queryAllByTestId(/^seg-fila-/).map((e) => e.getAttribute('data-testid')!.replace('seg-fila-', '')).sort()

beforeEach(() => {
  cleanup(); h.role = 'admin'; h.money = {}
  h.orders = [
    ped('o1', 'S1', 'paid', meta('Dra. Uno', FOR('dhl'))),                                   // foráneo pagado, en Almacén, sale hoy
    ped('o2', 'S2', 'paid', meta('Dra. Dos', FOR('estafeta', AYER))),                        // foráneo pagado, ya pasó su salida
    ped('o3', 'S3', 'shipped', meta('Dr. Tres', FOR('dhl'))),                                // foráneo con guía, en camino
    ped('o4', 'S4', 'delivered', meta('Dr. Cuatro', LOCAL)),                                 // local entregado por chofer
    ped('o5', 'S5', 'paid', meta('Dra. Cinco', LOCAL)),                                      // local pagado, en Almacén
    ped('o6', 'S6', 'pending_payment', meta('Dr. Seis', FOR('dhl')), { payment_status: 'pending' }),   // sin pagar: no es de Almacén
    ped('o7', 'S7', 'paid', meta('Caja', null, { channel: 'pos' })),                         // venta de mostrador: no es envío
    ped('o8', 'S8', 'shipped', meta('Dra. Ocho', null, { method: 'recoge' })),               // lista para recoger
  ]
  h.envios = [
    { id: 'e3', order_id: 'o3', driver_id: null, carrier: 'DHL', tracking_number: '1234567890', status: 'in_transit', created_at: `${HOY}T12:00:00Z`, estimated_delivery_at: null, incident: null },
    { id: 'e4', order_id: 'o4', driver_id: 'drv-1', carrier: null, tracking_number: null, status: 'delivered', created_at: `${HOY}T09:00:00Z`, estimated_delivery_at: null, incident: null, received_by: 'Recepción' },
  ]
})

describe('<Seguimiento> · Dirección ve también los foráneos', () => {
  it('aparecen los pagados que siguen en Almacén sin guía, no solo lo ya preparado', () => {
    render(<Seguimiento />)
    expect(folios()).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S8'])          // S6 (sin pagar) y S7 (mostrador) no son envíos por dar seguimiento
    const s1 = screen.getByTestId('seg-fila-S1')
    expect(s1).toHaveTextContent('Por preparar'); expect(s1).toHaveTextContent('DHL · sin guía todavía')
    expect(within(s1).getByTestId('seg-salida')).toHaveTextContent('Sale hoy antes de las 3:30 p.m. · DHL')
    expect(s1).not.toHaveTextContent('Detenido')
  })
  it('el foráneo que ya pasó su fecha de salida queda arriba como detenido y dice desde cuándo', () => {
    render(<Seguimiento />)
    const s2 = screen.getByTestId('seg-fila-S2')
    expect(s2).toHaveTextContent('Detenido'); expect(s2).toHaveTextContent('Estafeta · sin guía todavía')
    expect(s2).toHaveTextContent(/Sigue en Almacén sin preparar · debió salir el \d\d\/\d\d · Estafeta/)
    expect(screen.queryAllByTestId(/^seg-fila-/)[0]).toBe(s2)                 // los detenidos van primero
  })
  it('avisa cuántos siguen en Almacén, cuántos ya pasaron su salida y cuántos van por paquetería sin guía', () => {
    render(<Seguimiento />)
    const n = screen.getByTestId('seg-en-almacen')
    expect(n).toHaveTextContent('3 pedidos siguen en Almacén sin preparar · 1 ya pasó su fecha de salida.')
    expect(n).toHaveTextContent('2 van por paquetería y aún no tienen guía: el rastreo aparece aquí en cuanto Almacén la registra.')
    fireEvent.click(screen.getByTestId('seg-medio-chofer'))                   // con el filtro, el aviso habla solo de ese medio
    expect(screen.getByTestId('seg-en-almacen')).toHaveTextContent('1 pedido sigue en Almacén sin preparar.')
    expect(screen.getByTestId('seg-en-almacen')).not.toHaveTextContent('guía')
  })
  it('«envíos atorados» sigue contando lo mismo que Inicio y el Tablero: lo preparado sin salir o vencido, no lo de Almacén', () => {
    render(<Seguimiento />)
    expect(screen.queryByText(/envíos? atorados?\./)).toBeNull()               // S2 está detenido en Almacén: va en su propio aviso
    cleanup()
    h.orders = [...h.orders, ped('o9', 'S9', 'packed', meta('Dr. Nueve', FOR('dhl')))]   // preparado y sin envío: ese sí es un atorado
    render(<Seguimiento />)
    expect(screen.getByText(/1 envío atorado\./)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('seg-medio-chofer'))                   // con filtro, el aviso habla solo de ese medio
    expect(screen.queryByText(/envíos? atorados?\./)).toBeNull()
  })
  it('las fichas cuentan por dónde viaja y filtran: Paquetería deja solo foráneos; Chofer local, solo locales', () => {
    render(<Seguimiento />)
    expect(screen.getByTestId('seg-medio-todos')).toHaveTextContent('Todos 6')
    expect(screen.getByTestId('seg-medio-paqueteria')).toHaveTextContent('Paquetería 3')
    expect(screen.getByTestId('seg-medio-chofer')).toHaveTextContent('Chofer local 2')
    expect(screen.getByTestId('seg-medio-recoge')).toHaveTextContent('Lo recogen 1')
    fireEvent.click(screen.getByTestId('seg-medio-paqueteria'))
    expect(folios()).toEqual(['S1', 'S2', 'S3'])
    expect(screen.getByTestId('seg-etapa-por_preparar')).toHaveTextContent('Por preparar 2')
    expect(screen.getByTestId('seg-etapa-en_camino')).toHaveTextContent('En camino 1')
    fireEvent.click(screen.getByTestId('seg-etapa-en_camino'))
    expect(folios()).toEqual(['S3'])
    expect(screen.getByTestId('seg-fila-S3')).toHaveTextContent('DHL · guía 1234567890')
    fireEvent.click(screen.getByTestId('seg-etapa-en_camino'))                // tocar otra vez la quita
    fireEvent.click(screen.getByTestId('seg-medio-chofer'))
    expect(folios()).toEqual(['S4', 'S5'])
    expect(screen.getByTestId('seg-en-almacen')).not.toHaveTextContent('guía')   // el aviso de guías no aplica al chofer
    fireEvent.click(screen.getByTestId('seg-etapa-preparado'))
    expect(folios()).toEqual([]); expect(screen.getByTestId('seg-filtro-vacio')).toBeInTheDocument()
  })
  it('un pedido a crédito (liberado sin pagar) también aparece; uno pagado que el dinero no libera, no', () => {
    h.money = { o6: { liberado: true }, o1: { liberado: false } }
    render(<Seguimiento />)
    expect(folios()).toContain('S6'); expect(folios()).not.toContain('S1')
  })
  it('la vista del Inicio del vendedor («en camino») sigue igual: sin filtros y sin lo que está en Almacén', () => {
    h.role = 'pos'
    render(<Seguimiento embebido />)
    expect(screen.queryByTestId('seg-filtros')).toBeNull(); expect(screen.queryByTestId('seg-en-almacen')).toBeNull()
    expect(folios()).toEqual(['S3', 'S4', 'S8'])
  })
})

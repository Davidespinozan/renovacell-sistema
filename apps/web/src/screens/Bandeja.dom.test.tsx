// @vitest-environment jsdom
// W4-03 / W4-04 · LA BANDEJA — lo que requiere acción humana sobrevive a una recarga.
//
// Lo que se protege: que cada cola se derive del ESTADO DEL SERVIDOR (no de un aviso
// ni de memoria del navegador), que cada rol vea el trabajo que le toca, y que la
// bandeja no declare "todo al día" mientras hay algo esperando una decisión.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// El "servidor": lo que devuelven los stores. Todo se controla desde aquí.
const srv = vi.hoisted(() => ({
  role: 'admin' as string,
  orders: [] as unknown[], byOrder: {} as Record<string, unknown>, claims: [] as unknown[],
  shipments: [] as unknown[], lots: [] as unknown[], doctors: [] as unknown[], prospects: [] as unknown[],
  devoluciones: [] as unknown[], compras: [] as unknown[], custodias: [] as unknown[],
  fiscal: { total: 0, validados: 0, pendientes: 0, incompletos: 0 },
  mensajes: 0,
}))

vi.mock('../auth/RoleContext', () => ({ useRole: () => ({ role: srv.role, setScreen: vi.fn(), user: { email: 'x@y.mx' } }) }))
vi.mock('../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: srv.orders }) }))
vi.mock('../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: srv.byOrder }), usePaymentClaims: () => ({ data: srv.claims }) }))
vi.mock('../data/hooks/useShipments', () => ({ useShipments: () => ({ data: srv.shipments }) }))
vi.mock('../data/hooks/useLots', () => ({ useLots: () => ({ data: srv.lots }) }))
vi.mock('../data/hooks/useDoctors', () => ({ useDoctors: () => ({ data: srv.doctors }) }))
vi.mock('../data/hooks/useProspects', () => ({ useProspects: () => ({ data: srv.prospects }) }))
vi.mock('../data/hooks/useStockReturns', () => ({ useStockReturns: () => ({ data: srv.devoluciones }) }))
vi.mock('../data/hooks/useCompras', () => ({ useCompras: () => ({ data: srv.compras }) }))
vi.mock('../data/hooks/useCustody', () => ({ useCustodies: () => ({ data: srv.custodias }) }))
vi.mock('../data/hooks/useRevisionFiscal', () => ({ useRevisionFiscal: () => ({ avance: srv.fiscal, loading: false }) }))
vi.mock('../data/hooks/useComunicaciones', () => ({ useComunicaciones: () => ({ cuentas: { porEnviar: 0, enviados: 0, conProblema: srv.mensajes }, loading: false }) }))

import { Bandeja } from './Bandeja'

const dinero = (p: Record<string, unknown>) => ({ reembolso_pendiente: 0, vencido: false, sobrepago: false, saldo: 0, liberado: true, ...p })

beforeEach(() => {
  cleanup()
  Object.assign(srv, {
    role: 'admin', orders: [], byOrder: {}, claims: [], shipments: [], lots: [], doctors: [], prospects: [],
    devoluciones: [], compras: [], custodias: [], fiscal: { total: 0, validados: 0, pendientes: 0, incompletos: 0 }, mensajes: 0,
  })
})

describe('la cola es estado del servidor, no memoria del navegador', () => {
  it('SOBREVIVE A UNA RECARGA: se desmonta todo y, con el mismo estado del servidor, el pendiente sigue ahí', () => {
    srv.claims = [{ id: 'c1', status: 'reportado' }]
    const a = render(<Bandeja />)
    expect(screen.getByText('Pagos por validar')).toBeInTheDocument()
    a.unmount(); cleanup()          // "cerrar el navegador"
    render(<Bandeja />)             // "volver a abrir": no queda nada en memoria local
    expect(screen.getByText('Pagos por validar')).toBeInTheDocument()
  })

  it('cuando el servidor ya no lo reporta, la cola desaparece sola', () => {
    srv.claims = [{ id: 'c1', status: 'reportado' }]
    const a = render(<Bandeja />)
    expect(screen.getByText('Pagos por validar')).toBeInTheDocument()
    srv.claims = [{ id: 'c1', status: 'aprobado' }]
    a.rerender(<Bandeja />)
    expect(screen.queryByText('Pagos por validar')).toBeNull()
  })

  it('REGRESIÓN: si los pagos declarados llegan DESPUÉS de los pedidos, la bandeja se recalcula', () => {
    const a = render(<Bandeja />)
    expect(screen.queryByText('Pagos por validar')).toBeNull()
    srv.claims = [{ id: 'c1', status: 'reportado' }]   // llegó tarde; los pedidos no cambiaron
    a.rerender(<Bandeja />)
    expect(screen.getByText('Pagos por validar')).toBeInTheDocument()
  })

  it('no usa avisos como fuente: la pantalla no importa el store de notificaciones', async () => {
    const src = (await import('./Bandeja.tsx?raw')).default as string
    expect(src).not.toMatch(/notificationsStore|useNotifications|localStorage|sessionStorage/)
  })
})

describe('Dirección ve lo que espera SU decisión', () => {
  it('reembolso pendiente, crédito vencido y pago de más — del estado canónico del dinero', () => {
    srv.byOrder = {
      o1: dinero({ reembolso_pendiente: 350 }), o2: dinero({ vencido: true }), o3: dinero({ sobrepago: true }), o4: dinero({}),
    }
    render(<Bandeja />)
    expect(screen.getByText('Reembolsos por resolver')).toBeInTheDocument()
    expect(screen.getByText('Crédito vencido')).toBeInTheDocument()
    expect(screen.getByText('Pagos de más')).toBeInTheDocument()
  })

  it('devolución ya inspeccionada sin destino → espera a Dirección', () => {
    srv.devoluciones = [{ id: 'd1', lines: [{ inspection: 'ok', disposition: null }] }]
    render(<Bandeja />)
    expect(screen.getByText('Devoluciones por resolver')).toBeInTheDocument()
    expect(screen.queryByText('Devoluciones por inspeccionar')).toBeNull()
  })

  it('compras sin pagar y custodia de un evento que ya pasó', () => {
    srv.compras = [{ id: 'c', kind: 'compra', paid: false, status: 'recibida' }]
    srv.custodias = [{ id: 'k', status: 'abierta', kind: 'evento', event_date: '2020-01-01' }]
    render(<Bandeja />)
    expect(screen.getByText('Compras por pagar')).toBeInTheDocument()
    expect(screen.getByText('Custodias de evento por cerrar')).toBeInTheDocument()
  })

  it('una custodia de evento FUTURO no es un pendiente', () => {
    srv.custodias = [{ id: 'k', status: 'abierta', kind: 'evento', event_date: '2999-01-01' }]
    render(<Bandeja />)
    expect(screen.queryByText('Custodias de evento por cerrar')).toBeNull()
  })

  it('productos sin validar fiscalmente aparecen como pendiente de Dirección', () => {
    srv.fiscal = { total: 181, validados: 0, pendientes: 0, incompletos: 181 }
    render(<Bandeja />)
    expect(screen.getByText('Productos sin validar fiscalmente')).toBeInTheDocument()
    // El conteo aparece en el total de la bandeja y en la pastilla de la cola.
    expect(screen.getAllByText('181').length).toBeGreaterThanOrEqual(1)
  })

  it('NO dice "Todo al día" si lo único pendiente es lo fiscal', () => {
    srv.fiscal = { total: 181, validados: 0, pendientes: 0, incompletos: 181 }
    render(<Bandeja />)
    expect(screen.queryByText('Todo al día')).toBeNull()
  })

  it('mensajes al cliente que no salieron son un pendiente de Dirección', () => {
    srv.mensajes = 3
    render(<Bandeja />)
    expect(screen.getByText('Mensajes al cliente sin entregar')).toBeInTheDocument()
    expect(screen.queryByText('Todo al día')).toBeNull()
  })

  it('sin nada pendiente, entonces sí: todo al día', () => {
    render(<Bandeja />)
    expect(screen.getByText('Todo al día')).toBeInTheDocument()
  })
})

describe('Almacén ve su trabajo, no el de Dirección', () => {
  beforeEach(() => { srv.role = 'warehouse' })

  it('carga por despachar, compras por recibir y devoluciones por inspeccionar', () => {
    srv.shipments = [{ id: 's', status: 'por_despachar' }]
    srv.compras = [{ id: 'c', kind: 'compra', paid: true, status: 'parcial' }]
    srv.devoluciones = [{ id: 'd', lines: [{ inspection: null, disposition: null }] }]
    render(<Bandeja />)
    expect(screen.getByText('Carga por despachar')).toBeInTheDocument()
    expect(screen.getByText('Compras por recibir')).toBeInTheDocument()
    expect(screen.getByText('Devoluciones por inspeccionar')).toBeInTheDocument()
  })

  it('no ve las colas de dinero ni la fiscal', () => {
    srv.byOrder = { o1: dinero({ reembolso_pendiente: 350, vencido: true }) }
    srv.fiscal = { total: 181, validados: 0, pendientes: 0, incompletos: 181 }
    srv.compras = [{ id: 'c', kind: 'compra', paid: false, status: 'recibida' }]
    render(<Bandeja />)
    expect(screen.queryByText('Reembolsos por resolver')).toBeNull()
    expect(screen.queryByText('Crédito vencido')).toBeNull()
    expect(screen.queryByText('Compras por pagar')).toBeNull()
    expect(screen.queryByText('Productos sin validar fiscalmente')).toBeNull()
    srv.mensajes = 4
    expect(screen.queryByText('Mensajes al cliente sin entregar')).toBeNull()
  })

  it('una compra ya recibida completa no es un pendiente de Almacén', () => {
    srv.compras = [{ id: 'c', kind: 'compra', paid: false, status: 'recibida' }]
    render(<Bandeja />)
    expect(screen.queryByText('Compras por recibir')).toBeNull()
  })
})

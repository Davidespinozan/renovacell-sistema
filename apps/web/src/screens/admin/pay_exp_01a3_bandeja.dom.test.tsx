// @vitest-environment jsdom
// PAY-EXP-01A-3 · El contador de Bandeja y la lista de "Pagos por validar" usan EL MISMO universo: declaraciones
// 'reportado' de pedidos vigentes + las de pedidos aún no cargados (no se esconden); las de pedidos cancelados van a
// "Revisión económica" (aviso en la lista + tarea propia). La tarea de revisión: casos abiertos → cuenta; error de
// lectura → aviso (nunca "cero"); sin casos → nada.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'

const srv = vi.hoisted(() => ({
  setScreen: (() => {}) as (s: string) => void,
  revision: { estado: 'listo', data: { resumen: { abiertos: 0 } } } as Record<string, unknown>,
  orders: [] as unknown[], claims: [] as unknown[],
}))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'admin', setScreen: (s: string) => srv.setScreen(s), user: { email: 'x@y.mx', name: 'Dirección' } }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: srv.orders }) }))
vi.mock('../../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: {} }), usePaymentClaims: () => ({ data: srv.claims }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useLots', () => ({ useLots: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useDoctors', () => ({ useDoctors: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useProspects', () => ({ useProspects: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useStockReturns', () => ({ useStockReturns: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useCompras', () => ({ useCompras: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useCustody', () => ({ useCustodies: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useBankAccounts', () => ({ useBankAccounts: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useRevisionFiscal', () => ({ useRevisionFiscal: () => ({ avance: { total: 0, validados: 0 }, loading: false }) }))
vi.mock('../../data/hooks/useComunicaciones', () => ({ useComunicaciones: () => ({ cuentas: { porEnviar: 0, enviados: 0, conProblema: 0 }, loading: false }) }))
vi.mock('../../data/hooks/useSaludSistema', () => ({ useSaludSistema: () => ({ estado: 'healthy' }) }))
vi.mock('../../data/ops/atencion', () => ({ atencion: { resumen: async () => ({ ok: false, error: 'aislado' }) } }))
vi.mock('../../data/hooks/useRevisionEconomica', () => ({ useRevisionEconomica: () => ({ ...srv.revision, recargar: async () => {} }) }))
vi.mock('../../data/store/ordersStore', () => ({ reviewTransfer: vi.fn(async () => ({ ok: true })), reloadOrders: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, currentUserId: () => 'u', supabase: { rpc: async () => ({ data: null, error: { message: 'aislado' } }) } }))

import { Bandeja } from '../Bandeja'
import { PagosPorValidar } from './PagosPorValidar'
import { clasificarDeclaraciones } from '../../data/ops/pagosPendientes'
import { reloadOrders } from '../../data/store/ordersStore'

const esperar = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const ord = (id: string, status: string) => ({ id, external_ref: 'S' + id, status, total: 100, doctor_id: null, items: [], payment_status: 'pending' })
const claim = (id: string, order_id: string, status = 'reportado', declared_at = '2026-10-08T10:00:00Z') => ({ id, order_id, status, method: 'transferencia', amount_declared: 100, reference: 'R' + id, bank_account_id: null, proof_path: null, declared_at })
const cuentaDe = (titulo: string) => { const t = screen.queryByText(titulo); return t ? within(t.closest('button,div.card') as HTMLElement).getAllByText(/^\d+$/).map((x) => Number(x.textContent))[0] : null }

beforeEach(() => {
  cleanup()
  srv.setScreen = vi.fn()
  srv.revision = { estado: 'listo', data: { resumen: { abiertos: 0 } } }
  srv.orders = [ord('1', 'pending_payment'), ord('2', 'cancelled')]
  srv.claims = [claim('c1', '1'), claim('c2', '2'), claim('c3', 'NO-CARGADO', 'reportado', '2026-10-08T11:00:00Z'), claim('c4', '1', 'verificado')]
})

describe('PAY-EXP-01A-3 · un solo universo de declaraciones pendientes', () => {
  it('clasificador: vigentes = pedido vigente + pedido no cargado; cancelados aparte; verificadas fuera', () => {
    const r = clasificarDeclaraciones(srv.claims as never, srv.orders as never)
    expect(r.vigentes.map((x) => x.claim.id)).toEqual(['c3', 'c1'])   // más reciente primero
    expect(r.vigentes.find((x) => x.claim.id === 'c3')!.order).toBeNull()
    expect(r.enCancelados.map((x) => x.claim.id)).toEqual(['c2'])
  })
  it('Bandeja y "Pagos por validar" muestran EL MISMO número (2): ni el de pedido cancelado ni menos por el no cargado', async () => {
    render(<Bandeja />); await esperar()
    expect(cuentaDe('Pagos por validar')).toBe(2)
    cleanup()
    render(<PagosPorValidar />)
    expect(screen.getByTestId('pagos-contador')).toHaveTextContent('2 por revisar')
    expect(screen.getAllByTestId('pagos-fila')).toHaveLength(2)
  })
  it('la declaración con pedido NO cargado se lista con aviso y "Recargar" (no se esconde ni se actúa a ciegas)', () => {
    render(<PagosPorValidar />)
    expect(screen.getByText('Pedido aún no cargado')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('pagos-sin-pedido')).getByText('Recargar'))
    expect(reloadOrders).toHaveBeenCalled()
  })
  it('las de pedidos cancelados NO se pierden: aviso con cuenta y acceso a Revisión económica', () => {
    render(<PagosPorValidar />)
    expect(screen.getByTestId('pagos-en-cancelados')).toHaveTextContent('1 comprobante(s) de pedidos cancelados')
    fireEvent.click(screen.getByText('Ir a Revisión económica'))
    expect(srv.setScreen).toHaveBeenCalledWith('av_revision')
  })
})

describe('PAY-EXP-01A-3 · tarea "Revisión económica" en Bandeja', () => {
  it('con casos abiertos → tarea con su cuenta (destino av_revision)', async () => {
    srv.revision = { estado: 'listo', data: { resumen: { abiertos: 3 } } }
    render(<Bandeja />); await esperar()
    expect(cuentaDe('Revisión económica')).toBe(3)
    fireEvent.click(screen.getByText('Revisión económica'))
    expect(srv.setScreen).toHaveBeenCalledWith('av_revision')
  })
  it('error de lectura → aviso para reintentar (NO se muestra como "sin casos")', async () => {
    srv.revision = { estado: 'error', mensaje: 'x' }
    render(<Bandeja />); await esperar()
    expect(screen.getByText('No se pudo consultar; ábrela para reintentar.')).toBeInTheDocument()
  })
  it('sin casos → no hay tarea de revisión', async () => {
    render(<Bandeja />); await esperar()
    expect(screen.queryByText('Revisión económica')).toBeNull()
  })
})

// Guarda de fuente: los avisos de "listo para surtir" / "ya entró a preparación" exigen pagado y pedido NO cancelado
// (releído tras la operación); la revisión desde "Revisión económica" usa revisar_pago por declaración sin esos avisos.
import ordersStoreSrc from '../../data/store/ordersStore.ts?raw'
describe('PAY-EXP-01A-3 · avisos veraces al verificar', () => {
  it('reviewTransfer solo avisa "listo para surtir" con pago completo y pedido no cancelado', () => {
    expect(ordersStoreSrc).toMatch(/const preparable = r\.data\.payment_status === 'paid' && fresco\.status !== 'cancelled'/)
    expect(ordersStoreSrc).toMatch(/if \(preparable\) notify\(\{ text: `Transferencia confirmada/)
    expect(ordersStoreSrc).toMatch(/if \(preparable && o\.doctor_id\) notify\(\{ text: `Tu pago del pedido/)
  })
  it('revisarDeclaracion usa el comando canónico y no emite avisos de preparación ni de reintento', () => {
    const cuerpo = ordersStoreSrc.slice(ordersStoreSrc.indexOf('export async function revisarDeclaracion'), ordersStoreSrc.indexOf('// Espejo local del efecto'))
    expect(cuerpo).toMatch(/await cmdRevisarPago\(opId, \{ claimId, accion, motivo: motivo \?\? null \}\)/)
    expect(cuerpo).not.toMatch(/notify\(/)
    expect(cuerpo).not.toMatch(/supabase\.from\(/)
  })
})

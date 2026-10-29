// @vitest-environment jsdom
// CS-1A.3 · PaymentModal: con la bandera APAGADA (defecto) la rama de tarjeta es la de siempre; con la bandera encendida monta
// Microform, no hay botón "Pagar", no se llama a Stripe ni a report-transfer ni a cobro alguno, y Transferencia sigue intacta.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ data: null, error: null })) }))
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { functions: { invoke } } }))
vi.mock('../../lib/stripe', () => ({ startStripeCheckout: vi.fn(async () => ({ redirected: false })) }))
vi.mock('../../data/hooks/useBankAccounts', () => ({ useBankAccounts: () => ({ data: [{ id: 'b1', active: true, is_default: true, display_order: 1, bank_name: 'BanBajío', beneficiary_name: 'Renovacell', clabe: '030180000000000001', account_number: null }] }) }))
const flags = vi.hoisted(() => ({ CS_MICROFORM_HABILITADO: false }))
vi.mock('../../data/payments/flags', () => flags)
vi.mock('./MicroformTarjeta', () => ({ MicroformTarjeta: ({ orderId, onToken, onRecuperar }: { orderId: string; onToken: (t: unknown) => void; onRecuperar?: (id: string) => void }) => (
  <div data-testid="microform-falso" data-order={orderId}>
    <button type="button" data-testid="mf-emitir" onClick={() => onToken({ token: 'tok', attemptId: 'a', amount: 6000, ambiente: 'test' })}>emitir</button>
    <button type="button" data-testid="mf-recuperar" onClick={() => onRecuperar?.('att-reto')}>recuperar</button>
  </div>) }))
const a3ds = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }))
vi.mock('./Autenticacion3DS', () => ({ Autenticacion3DS: (p: { attemptId: string; token: string | null; modo?: string; onFin?: (f: string) => void }) => {
  a3ds.props.push({ attemptId: p.attemptId, token: p.token, modo: p.modo ?? 'completo' })
  return <div data-testid="a3ds-falso" data-modo={p.modo ?? 'completo'}><button type="button" data-testid="a3ds-completar" onClick={() => p.onFin?.('completada')}>fin</button></div>
} }))
const cpago = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }))
vi.mock('./ConfirmacionPago', () => ({ ConfirmacionPago: (p: { attemptId: string; token: string | null; amount: number; onFin?: (f: string) => void }) => {
  cpago.props.push({ attemptId: p.attemptId, token: p.token, amount: p.amount })
  return <div data-testid="cpago-falso"><button type="button" data-testid="cpago-confirmar" onClick={() => p.onFin?.('confirmado')}>ok</button><button type="button" data-testid="cpago-recuperable" onClick={() => p.onFin?.('recuperable')}>rec</button></div>
} }))

import { PaymentModal } from './PaymentModal'
import { _fijarPagosEnLinea } from '../../data/ops/pagosEnLinea'

beforeEach(() => { cleanup(); _fijarPagosEnLinea(true); invoke.mockClear(); flags.CS_MICROFORM_HABILITADO = false; a3ds.props.length = 0; cpago.props.length = 0 })
const props = { folio: 'S100002', amount: 6000, orderId: '11111111-1111-4111-8111-111111111111', onPaid: vi.fn(), onClose: vi.fn() }

describe('CS-1A.3 · PaymentModal y la bandera', () => {
  it('bandera apagada: rama de tarjeta clásica con botón Pagar; Microform ausente', () => {
    render(<PaymentModal {...props} />)
    expect(screen.queryByTestId('microform-falso')).toBeNull()
    expect(screen.getByPlaceholderText('4242 4242 4242 4242')).toBeTruthy()
    expect(screen.getByText(/^Pagar \$?6,000/)).toBeTruthy()
    expect(screen.queryByTestId('pm-cs-espera')).toBeNull()
  })
  it('bandera encendida: Microform montado con el pedido, sin botón Pagar, sin llamadas de cobro; el token solo cambia el texto de espera', async () => {
    flags.CS_MICROFORM_HABILITADO = true
    render(<PaymentModal {...props} />)
    const mf = screen.getByTestId('microform-falso'); expect(mf.getAttribute('data-order')).toBe(props.orderId)
    expect(screen.queryByText(/^Pagar \$?6,000/)).toBeNull()
    expect(screen.queryByPlaceholderText('4242 4242 4242 4242')).toBeNull()
    expect(screen.getByTestId('pm-cs-espera').textContent).toContain('Captura tu tarjeta')
    fireEvent.click(screen.getByTestId('mf-emitir'))
    // CS-1A.4: con el token, Microform cede el lugar a la autenticación 3DS (modo completo, token en memoria)
    expect(screen.queryByTestId('microform-falso')).toBeNull()
    expect(screen.getByTestId('a3ds-falso').getAttribute('data-modo')).toBe('completo')
    expect(a3ds.props).toEqual([{ attemptId: 'a', token: 'tok', modo: 'completo' }])
    expect(screen.getByTestId('pm-cs-espera').textContent).toContain('Autenticación bancaria en curso')
    fireEvent.click(screen.getByTestId('a3ds-completar'))
    // CS-1A.5: 3DS completada → ConfirmacionPago con el MISMO intento y token (en memoria); el modal no llama a nada por sí mismo
    expect(screen.queryByTestId('a3ds-falso')).toBeNull()
    expect(cpago.props).toEqual([{ attemptId: 'a', token: 'tok', amount: 6000 }])
    expect(screen.getByTestId('pm-cs-espera').textContent).toContain('Procesando el pago')
    fireEvent.click(screen.getByTestId('cpago-confirmar'))
    expect(screen.getByTestId('pm-cs-espera').textContent).toContain('Pago confirmado')
    expect(screen.queryByText(/^Pagar \$?6,000/)).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
    expect(props.onPaid).not.toHaveBeenCalled()   // el modal NUNCA simula el cobro por el store
    expect(document.body.textContent).not.toMatch(/pago exitoso|Pago recibido/i)
  })
  it('bandera encendida: un resultado recuperable (importe cambió / token caducado) vuelve a la captura sin disparar cargos', () => {
    flags.CS_MICROFORM_HABILITADO = true
    render(<PaymentModal {...props} />)
    fireEvent.click(screen.getByTestId('mf-emitir')); fireEvent.click(screen.getByTestId('a3ds-completar'))
    fireEvent.click(screen.getByTestId('cpago-recuperable'))
    expect(screen.getByTestId('microform-falso')).toBeTruthy()
    expect(screen.queryByTestId('cpago-falso')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })
  it('bandera encendida: un reto 3DS interrumpido se recupera en modo validar, sin volver a capturar la tarjeta', () => {
    flags.CS_MICROFORM_HABILITADO = true
    render(<PaymentModal {...props} />)
    fireEvent.click(screen.getByTestId('mf-recuperar'))
    expect(screen.queryByTestId('microform-falso')).toBeNull()
    expect(a3ds.props).toEqual([{ attemptId: 'att-reto', token: null, modo: 'validar' }])
    expect(invoke).not.toHaveBeenCalled()
  })
  it('bandera encendida: Transferencia sigue igual (declaración vía report-transfer, sin tocar Microform)', async () => {
    flags.CS_MICROFORM_HABILITADO = true
    render(<PaymentModal {...props} />)
    fireEvent.click(screen.getByText('Transferencia'))
    expect(screen.queryByTestId('microform-falso')).toBeNull()
    expect(screen.getByText('Ya realicé la transferencia')).toBeTruthy()
    fireEvent.click(screen.getByText('Ya realicé la transferencia'))
    await screen.findByText('Listo')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect((invoke.mock.calls[0] as unknown[])[0]).toBe('report-transfer')
  })
})

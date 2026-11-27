// @vitest-environment jsdom
// PAGO A PROVEEDOR CON SUS DATOS (27 nov 2026, dueño: «al pagar a proveedor hay que hacer mejor captura de datos de
// cómo se pagó y de qué banco se pagó»). Antes «Marcar pagado» solo ponía la compra como pagada, sin ningún dato.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ rpc: vi.fn(), recargar: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: (fn: string, a: unknown) => h.rpc(fn, a), from: () => ({}) } }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'admin', user: { name: 'Claudia' } }), useRoleOpcional: () => ({ role: 'admin', screen: 'compras', capabilities: [] }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'p1', name: 'Golden Serum', price: 900, unit: null }] }) }))
vi.mock('../../data/hooks/useLots', () => ({ useLots: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useBankAccounts', () => ({ useBankAccounts: () => ({ data: [
  { id: 'c1', bank_name: 'Scotiabank', clabe: '044180001234569474', account_number: null, active: true, is_default: true },
  { id: 'c2', bank_name: 'Banbajio', clabe: null, account_number: '1236813', active: true, is_default: false },
] }) }))
vi.mock('../../data/hooks/useCompras', () => ({ useCompras: () => ({ data: [
  { id: 'r1', product_id: 'p1', product_name: 'Golden Serum', qty: 10, unit_cost: 450, kind: 'compra', supplier: 'Laboratorio Uno', status: 'pendiente', paid: false, created_at: '2026-11-26T10:00:00Z', received_qty: 0 },
  { id: 'r2', product_id: 'p1', product_name: 'Golden Serum', qty: 5, unit_cost: 400, kind: 'compra', supplier: 'Laboratorio Dos', status: 'recibida', paid: true, created_at: '2026-11-20T10:00:00Z', received_qty: 5 },
], createReplenishment: vi.fn(), reloadCompras: h.recargar }) }))
vi.mock('../../app/GuiaInventario', () => ({ GuiaInventario: () => null }))
vi.mock('../../data/store/nivelesStockStore', () => ({ useNivelesStock: () => ({}), guardarNivel: vi.fn() }))
import { Reabastecimiento } from './Reabastecimiento'
import { faltaEnPago, resumenPago } from '../../data/ops/pagosProveedor'

const PAGO_R2 = { compra: 'r2', monto: 2000, forma: 'transferencia', cuenta: 'Scotiabank · 9474', banco_proveedor: 'BBVA', referencia: 'SPEI 777', fecha: '2026-11-21', notas: null, registro: 'Claudia', registrado_at: '2026-11-21T18:00:00Z' }
beforeEach(() => {
  cleanup(); h.recargar.mockReset(); h.rpc.mockReset()
  h.rpc.mockImplementation(async (fn: string) => fn === 'compra_pagos_ver' ? { data: [PAGO_R2], error: null } : fn === 'compra_registrar_pago' ? { data: { monto: 4500 }, error: null } : { data: null, error: null })
})
const fila = (texto: string) => screen.getAllByTestId('fila-compra').find((f) => f.textContent?.includes(texto))!

describe('reglas de la captura', () => {
  it('pide cómo se pagó, la cuenta y la referencia según la forma', () => {
    const base = { forma: '' as const, cuentaId: '', fecha: '2026-11-27', referencia: '', bancoProveedor: '', notas: '' }
    expect(faltaEnPago(base, '2026-11-27')).toBe('Elige cómo se pagó.')
    expect(faltaEnPago({ ...base, forma: 'transferencia' }, '2026-11-27')).toMatch(/de qué cuenta/)
    expect(faltaEnPago({ ...base, forma: 'transferencia', cuentaId: 'c1' }, '2026-11-27')).toMatch(/referencia o folio/)
    expect(faltaEnPago({ ...base, forma: 'cheque', cuentaId: 'c1' }, '2026-11-27')).toMatch(/número de cheque/)
    expect(faltaEnPago({ ...base, forma: 'efectivo' }, '2026-11-27')).toBeNull()
    expect(faltaEnPago({ ...base, forma: 'efectivo', fecha: '2026-11-28' }, '2026-11-27')).toMatch(/futura/)
  })
  it('el resumen dice forma, cuenta, banco del proveedor, referencia y fecha', () => {
    expect(resumenPago(PAGO_R2 as never)).toBe('Transferencia · desde Scotiabank · 9474 · a BBVA · ref SPEI 777 · 21 nov 2026')
  })
})

describe('<Reabastecimiento> · registrar el pago', () => {
  it('una compra ya pagada dice cómo se pagó', async () => {
    render(<Reabastecimiento />)
    expect(await within(fila('Laboratorio Dos')).findByTestId('pago-resumen')).toHaveTextContent('Transferencia · desde Scotiabank · 9474 · a BBVA · ref SPEI 777')
  })
  it('«Registrar pago» captura los datos y los manda al servidor; sin referencia no deja', async () => {
    render(<Reabastecimiento />)
    fireEvent.click(within(fila('Laboratorio Uno')).getByTestId('btn-pagado'))
    const m = screen.getByTestId('pago-modal')
    expect(within(m).getByTestId('pago-monto')).toHaveTextContent('$4,500.00')
    expect(within(m).getByTestId('pago-guardar')).toBeDisabled()
    fireEvent.click(within(m).getByTestId('pago-forma-transferencia'))
    expect((within(m).getByTestId('pago-cuenta') as HTMLSelectElement).value).toBe('c1')    // la cuenta principal ya viene elegida
    expect(within(m).getByTestId('pago-guardar')).toBeDisabled()                            // falta la referencia
    fireEvent.change(within(m).getByTestId('pago-referencia'), { target: { value: 'SPEI 123456' } })
    fireEvent.change(within(m).getByLabelText('Banco del proveedor'), { target: { value: 'BBVA' } })
    fireEvent.click(within(m).getByTestId('pago-guardar'))
    await waitFor(() => expect(screen.queryByTestId('pago-modal')).toBeNull())
    const llamada = h.rpc.mock.calls.find((c) => c[0] === 'compra_registrar_pago')!
    expect(llamada[1]).toMatchObject({ p_compra: 'r1', p_forma: 'transferencia', p_cuenta: 'c1', p_referencia: 'SPEI 123456', p_banco_proveedor: 'BBVA' })
    expect(h.recargar).toHaveBeenCalled()
  })
  it('si el servidor lo rechaza, lo dice y la ventana sigue abierta', async () => {
    h.rpc.mockImplementation(async (fn: string) => fn === 'compra_registrar_pago' ? { data: null, error: { message: 'COMPRA_YA_PAGADA: esta compra ya está registrada como pagada' } } : { data: [], error: null })
    render(<Reabastecimiento />)
    fireEvent.click(within(fila('Laboratorio Uno')).getByTestId('btn-pagado'))
    fireEvent.click(screen.getByTestId('pago-forma-efectivo'))
    fireEvent.click(screen.getByTestId('pago-guardar'))
    expect(await screen.findByTestId('pago-error')).toHaveTextContent('Esta compra ya está registrada como pagada')
    expect(screen.getByTestId('pago-modal')).toBeTruthy()
  })
})

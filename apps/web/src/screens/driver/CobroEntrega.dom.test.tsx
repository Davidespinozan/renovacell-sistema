// @vitest-environment jsdom
// COBRO AL ENTREGAR (19 nov 2026)
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CobroEntrega } from './CobroEntrega'
import sql from '../../../../../supabase/migrations/20270407280000_cobro_chofer.sql?raw'

afterEach(cleanup)
const est = (sobre = {}) => ({ order_id: 'o1', total: 1500, cobrado: 0, saldo: 1500, payment_status: 'pending', credito: false, cancelado: false, ...sobre })
const api = (registrar = vi.fn(async () => ({ ok: true as const, data: { saldo: 0, payment_status: 'paid' } })), e = est()) => ({ estado: vi.fn(async () => ({ ok: true as const, data: e })), registrar }) as never

describe('Cobro al entregar', () => {
  it('muestra el saldo, registra el efectivo y queda pagado', async () => {
    const reg = vi.fn(async () => ({ ok: true as const, data: { saldo: 0, payment_status: 'paid' } }))
    render(<CobroEntrega shipmentId="s1" cliente={api(reg)} />)
    expect(await screen.findByTestId('cobro-entrega')).toHaveTextContent(/Cobrar .*1,500/)
    fireEvent.click(screen.getByTestId('cobro-efectivo'))
    await waitFor(() => expect(reg).toHaveBeenCalledWith('s1', 'efectivo', 1500, null, expect.any(String)))
    expect(await screen.findByTestId('cobro-pagado')).toHaveTextContent('Quedó pagado')
  })
  it('pagado o cancelado: no cobra', async () => {
    render(<CobroEntrega shipmentId="s1" cliente={api(undefined, est({ saldo: 0, payment_status: 'paid' }))} />)
    expect(await screen.findByTestId('cobro-pagado')).toHaveTextContent('no cobres')
    cleanup()
    render(<CobroEntrega shipmentId="s1" cliente={api(undefined, est({ cancelado: true }))} />)
    expect(await screen.findByTestId('cobro-cancelado')).toBeTruthy()
  })
  it('un reintento sin señal usa el MISMO id (no cobra doble)', async () => {
    const reg = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Sin conexión' }).mockResolvedValueOnce({ ok: true, data: { saldo: 0, payment_status: 'paid' } })
    render(<CobroEntrega shipmentId="s1" cliente={api(reg as never)} />)
    fireEvent.click(await screen.findByTestId('cobro-efectivo'))
    await screen.findByTestId('cobro-error')
    fireEvent.click(screen.getByTestId('cobro-efectivo'))
    await waitFor(() => expect(reg).toHaveBeenCalledTimes(2))
    expect(reg.mock.calls[0][4]).toBe(reg.mock.calls[1][4])
  })
  it('la base: solo su entrega, nunca más del saldo, nunca cancelado', () => {
    expect(sql).toMatch(/s\.driver_id is distinct from auth\.uid\(\)/)
    expect(sql).toMatch(/MONTO_MAYOR/); expect(sql).toMatch(/PEDIDO_CANCELADO/); expect(sql).toMatch(/YA_PAGADO/)
  })
})

// @vitest-environment jsdom
// PAGOS EN LÍNEA · Dirección apaga/enciende con confirmación; el modal de pago del doctor no ofrece "Tarjeta" apagado.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { PagosEnLineaEditor } from './PagosEnLineaEditor'
import { PaymentModal } from '../doctor/PaymentModal'
import { _fijarPagosEnLinea } from '../../data/ops/pagosEnLinea'
import edgeCs from '../../../../../supabase/functions/cs-capture-context/index.ts?raw'
import edgePago from '../../../../../supabase/functions/cs-pago/index.ts?raw'
import edgeStripe from '../../../../../supabase/functions/stripe-checkout/index.ts?raw'

beforeEach(cleanup)

describe('Pagos en línea · Dirección', () => {
  it('muestra el estado y lo cambia solo tras confirmar', async () => {
    const guardar = vi.fn(async (v: boolean) => ({ ok: true as const, data: { tarjeta_en_linea: v, updated_at: '2026-10-28T20:00:00Z' } }))
    render(<PagosEnLineaEditor ver={async () => ({ ok: true as const, data: { tarjeta_en_linea: false, updated_at: null } })} guardar={guardar} />)
    await waitFor(() => expect(screen.getByTestId('pagos-estado')).toHaveTextContent('Apagados'))
    fireEvent.click(screen.getByTestId('pagos-cambiar'))
    expect(guardar).not.toHaveBeenCalled()
    fireEvent.click(within(document.querySelector('.overlay') as HTMLElement).getByRole('button', { name: 'Activar' }))
    await waitFor(() => expect(screen.getByTestId('pagos-estado')).toHaveTextContent('Activos'))
    expect(guardar).toHaveBeenCalledWith(true)
  })
})

describe('Pagos en línea · portal del doctor', () => {
  it('apagado: sin opción de tarjeta, directo a transferencia', () => {
    _fijarPagosEnLinea(false)
    render(<PaymentModal folio="S1" amount={1000} onPaid={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('pago-sin-tarjeta')).toHaveTextContent('transferencia')
    expect(screen.queryByLabelText(/Número de tarjeta/)).toBeNull()
    expect(screen.queryByText('Número de tarjeta')).toBeNull()
  })
  it('activo: vuelve la opción de tarjeta', () => {
    _fijarPagosEnLinea(true)
    render(<PaymentModal folio="S1" amount={1000} onPaid={() => {}} onClose={() => {}} />)
    expect(screen.queryByTestId('pago-sin-tarjeta')).toBeNull()
    expect(screen.getByRole('button', { name: 'Tarjeta' })).toBeVisible()
  })
  it('el servidor también se niega a iniciar cobros con tarjeta apagado', () => {
    for (const s of [edgeCs, edgeStripe]) expect(s).toMatch(/if \(!\(await tarjetaEnLineaActiva\(/)
    expect(edgePago).toMatch(/accion === 'pagar' && !\(await tarjetaEnLineaActiva\(admin\)\)/)
  })
})

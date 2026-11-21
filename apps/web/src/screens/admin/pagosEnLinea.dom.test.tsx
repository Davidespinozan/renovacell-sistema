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

describe('Pagos en línea · bitácora de pruebas de BanBajío (CS-BB)', () => {
  const ver = async () => ({ ok: true as const, data: { tarjeta_en_linea: false, updated_at: null } })
  it('sin filas no hay botón; con filas, «Descargar bitácora de pruebas (CSV)» arma el CSV enmascarado que da el servidor', async () => {
    render(<PagosEnLineaEditor ver={ver} contarBitacora={async () => 0} />)
    await waitFor(() => expect(screen.getByTestId('pagos-estado')).toBeInTheDocument())
    expect(screen.queryByTestId('bitacora-pruebas')).toBeNull()
    cleanup()
    const descargar = vi.fn()
    const fila = { created_at: '2026-11-21T18:00:00Z', attempt_id: 'a-1', paso: 'enroll', metodo: 'POST', ruta: '/risk/v1/authentications', http_status: 201, resultado: 'ok', duracion_ms: 90, request: { tokenInformation: { jti: '1C66OQ…66ED' } }, response: { consumerAuthenticationInformation: { paresStatus: 'Y', cavv: '••••AAA=' } } }
    render(<PagosEnLineaEditor ver={ver} contarBitacora={async () => 1} leerBitacora={async () => ({ ok: true as const, filas: [fila] })} descargar={descargar} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar bitácora de pruebas (CSV)' }))
    await waitFor(() => expect(descargar).toHaveBeenCalledTimes(1))
    const [nombre, csv] = descargar.mock.calls[0] as [string, string]
    expect(nombre).toMatch(/^bitacora-pruebas-cybersource-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv.split('\r\n')[0]).toBe('created_at,attempt_id,paso,metodo,ruta,http_status,resultado,duracion_ms,request,response')
    expect(csv).toContain('1C66OQ…66ED'); expect(csv).toContain('••••AAA=')
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

// @vitest-environment jsdom
// STRYV Care: mismo flujo que Fukuroll — estado, activar (Stripe Checkout), portal y recibos; y el regreso de Stripe.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { StryvCare } from './StryvCare'
import { regresoDeStripe, type stryvCare } from '../../data/ops/stryvCare'

afterEach(cleanup)
const cliente = (estado: Record<string, unknown>, url = 'https://checkout.stripe.test/x') => ({
  estado: vi.fn(async () => ({ ok: true as const, data: estado as never })),
  activar: vi.fn(async () => ({ ok: true as const, data: { url } })),
  portal: vi.fn(async () => ({ ok: true as const, data: { url } })),
}) as unknown as typeof stryvCare

describe('STRYV Care', () => {
  it('sin activar: precio, lo que incluye y "Activar STRYV Care" abre Stripe', async () => {
    const c = cliente({ estado: 'inactivo', monto_centavos: 250000, puede_activar: true })
    const asignar = vi.fn(); Object.defineProperty(window, 'location', { value: { ...window.location, set href(v: string) { asignar(v) } }, writable: true })
    render(<StryvCare cliente={c} />)
    expect(await screen.findByText('$2,500')).toBeInTheDocument()
    expect(screen.getByTestId('care-estado').textContent).toBe('Sin activar')
    expect(screen.getByText(/Soporte directo con STRYV/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('care-activar'))
    await waitFor(() => expect(asignar).toHaveBeenCalledWith('https://checkout.stripe.test/x'))
  })
  it('activo: próximo cobro, tarjeta, portal y recibos', async () => {
    render(<StryvCare cliente={cliente({ estado: 'active', monto_centavos: 250000, proximo_cobro: 1798761600, tarjeta: { marca: 'visa', last4: '4242' }, recibos: [{ fecha: 1796083200, monto_centavos: 250000, estado: 'paid', url: 'https://inv' }] })} />)
    expect(await screen.findByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('VISA ···· 4242')).toBeInTheDocument()
    expect(screen.getByTestId('care-portal')).toBeInTheDocument()
    expect(screen.getByText('Pagado')).toBeInTheDocument()
  })
  it('sin llave de Stripe: "Aún no está disponible", sin botón de activar', async () => {
    render(<StryvCare cliente={cliente({ estado: 'no_disponible' })} />)
    expect(await screen.findByText(/Aún no está disponible/)).toBeInTheDocument()
    expect(screen.queryByTestId('care-activar')).toBeNull()
  })
  it('regreso de Stripe: reconoce ?care=ok|cancel|volver y nada más', () => {
    expect(regresoDeStripe({ search: '?care=ok', pathname: '/' })).toBe('ok')
    expect(regresoDeStripe({ search: '?x=1&care=cancel', pathname: '/' })).toBe('cancel')
    expect(regresoDeStripe({ search: '?care=otro', pathname: '/' })).toBeNull()
    expect(regresoDeStripe({ search: '', pathname: '/' })).toBeNull()
  })
})

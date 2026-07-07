// @vitest-environment jsdom
// Tests de Mis pedidos e Historial del doctor (modo mock). Los pedidos activos y
// los históricos deben separarse por estatus.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MisPedidos } from './MisPedidos'
import { Historial } from './Historial'

beforeEach(cleanup)

describe('<MisPedidos>', () => {
  it('lista los pedidos ACTIVOS y no los entregados', () => {
    render(<MisPedidos />)
    expect(screen.getByText('Portal del Doctor · Mis pedidos')).toBeInTheDocument()
    // S3559 (shipped) y S12840 (packed) son activos.
    expect(screen.getByText(/S3559/)).toBeInTheDocument()
    // S3683 está entregado → NO va aquí, va en el historial.
    expect(screen.queryByText(/S3683/)).toBeNull()
  })

  it('un pedido pendiente de pago ofrece "Pagar" y abre la pasarela', () => {
    render(<MisPedidos />)
    // S3712 está pendiente de pago → tiene botón Pagar.
    const pagar = screen.getByRole('button', { name: /Pagar/ })
    fireEvent.click(pagar)
    // Se abre el modal de pago (UI-first, seam Stripe).
    expect(screen.getByPlaceholderText('4242 4242 4242 4242')).toBeInTheDocument()
  })
})

describe('<Historial>', () => {
  it('lista los pedidos históricos (entregados/cancelados)', () => {
    render(<Historial />)
    expect(screen.getByText('Portal del Doctor · Historial')).toBeInTheDocument()
    // S3683 (delivered) es histórico.
    expect(screen.getByText(/S3683/)).toBeInTheDocument()
    // S3559 (shipped) sigue activo → no está en el historial.
    expect(screen.queryByText(/S3559/)).toBeNull()
  })
})

// @vitest-environment jsdom
// Tests de Mis pedidos e Historial del doctor (modo mock). Los pedidos activos y
// los históricos deben separarse por estatus.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RoleProvider } from '../../auth/RoleContext'
import { takeReorderSeed } from '../../data/store/reorderStore'
import { MisPedidos } from './MisPedidos'
import { Historial } from './Historial'

beforeEach(cleanup)

// Estas pantallas usan useRole() (para "Volver a pedir" → navegar al catálogo),
// así que deben renderizarse dentro del provider, como en la app real.
const renderWithRole = (ui: JSX.Element) => render(<RoleProvider>{ui}</RoleProvider>)

describe('<MisPedidos>', () => {
  it('lista los pedidos ACTIVOS y no los entregados', () => {
    renderWithRole(<MisPedidos />)
    expect(screen.getByText('Portal del Doctor · Mis pedidos')).toBeInTheDocument()
    // S3559 (shipped) y S12840 (packed) son activos.
    expect(screen.getByText(/S3559/)).toBeInTheDocument()
    // S3683 está entregado → NO va aquí, va en el historial.
    expect(screen.queryByText(/S3683/)).toBeNull()
  })

  it('un pedido pendiente de pago ofrece "Pagar" y abre la pasarela', () => {
    renderWithRole(<MisPedidos />)
    // S3712 está pendiente de pago → tiene botón Pagar.
    const pagar = screen.getByRole('button', { name: /Pagar/ })
    fireEvent.click(pagar)
    // Se abre el modal de pago (UI-first, seam Stripe).
    expect(screen.getByPlaceholderText('4242 4242 4242 4242')).toBeInTheDocument()
  })
})

describe('<Historial>', () => {
  it('lista los pedidos históricos (entregados/cancelados)', () => {
    renderWithRole(<Historial />)
    expect(screen.getByText('Portal del Doctor · Historial')).toBeInTheDocument()
    // S3683 (delivered) es histórico.
    expect(screen.getByText(/S3683/)).toBeInTheDocument()
    // S3559 (shipped) sigue activo → no está en el historial.
    expect(screen.queryByText(/S3559/)).toBeNull()
  })

  it('"Volver a pedir" siembra los renglones del pedido para el catálogo', () => {
    takeReorderSeed() // limpia cualquier siembra previa
    renderWithRole(<Historial />)
    const btn = screen.getAllByRole('button', { name: /Volver a pedir/ })[0]
    fireEvent.click(btn)
    const seed = takeReorderSeed()
    expect(seed).not.toBeNull()
    expect(seed!.length).toBeGreaterThan(0)
    expect(seed![0]).toHaveProperty('product_id')
    expect(seed![0].qty).toBeGreaterThan(0)
  })
})

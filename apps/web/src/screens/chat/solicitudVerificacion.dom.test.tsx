// @vitest-environment jsdom
// VERIFICACIÓN POR WHATSAPP · el personal ve en el chat lo que la IA juntó y aprueba o rechaza con un toque.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useSolicitudVerificacion } from './SolicitudVerificacion'
import type { ClienteVerificacionWa, SolicitudAlta } from '../../data/ops/verificacionWa'

afterEach(cleanup)
const sol: SolicitudAlta = { id: 'S1', estado: 'pendiente', nombre: 'Kattya Muciño', cedula: '12345678', email: 'k@x.mx', especialidad: 'Medicina estética', ciudad: 'Culiacán', adjuntos: ['a1'], created_at: '', motivo: null, posible_cliente: false }
const cli = (s: SolicitudAlta | null = sol): ClienteVerificacionWa => ({ de: vi.fn(async () => ({ ok: true as const, data: s })), aprobar: vi.fn(async () => ({ ok: true as const, data: { ok: true } })), rechazar: vi.fn(async () => ({ ok: true as const, data: null })) })
function Tira({ c }: { c: ClienteVerificacionWa }) { return <>{useSolicitudVerificacion('C1', c)}</> }

describe('solicitud de verificación en el chat', () => {
  it('muestra los datos y aprueba con un toque', async () => {
    const c = cli(); render(<Tira c={c} />)
    expect(await screen.findByText(/Kattya Muciño · cédula 12345678 · k@x.mx/)).toBeTruthy()
    expect(screen.getByText(/1 foto\(s\) en la conversación/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('verif-aprobar'))
    await waitFor(() => expect(c.aprobar).toHaveBeenCalledWith('S1'))
    expect(await screen.findByText(/quedó verificado: ya tiene su cuenta, su WhatsApp quedó ligado/)).toBeTruthy()
  })
  it('rechaza con motivo que se le dice al cliente', async () => {
    const c = cli(); vi.spyOn(window, 'prompt').mockReturnValue('la foto no se ve')
    render(<Tira c={c} />)
    fireEvent.click(await screen.findByTestId('verif-rechazar'))
    await waitFor(() => expect(c.rechazar).toHaveBeenCalledWith('S1', 'la foto no se ve'))
  })
  it('sin solicitud pendiente no muestra nada', async () => {
    const c = cli(null); const { container } = render(<Tira c={c} />)
    await waitFor(() => expect(c.de).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})

// @vitest-environment jsdom
// ETIQUETAS EN LA FICHA (15 nov 2026)
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EtiquetasCliente } from './EtiquetasCliente'
import type { ClienteDifusiones } from '../../data/ops/difusiones'

describe('etiquetas del cliente', () => {
  it('pone, quita y crea etiquetas', async () => {
    const etiquetasDe = vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'e1', nombre: 'Compra cada mes', puesta: false }] })
    const cambiarClientes = vi.fn().mockResolvedValue({ ok: true, data: {} })
    const guardarLista = vi.fn().mockResolvedValue({ ok: true, data: { id: 'e2' } })
    const cliente = { etiquetasDe, cambiarClientes, guardarLista } as unknown as ClienteDifusiones
    render(<EtiquetasCliente customerId="c1" cliente={cliente} />)
    const chip = await screen.findByRole('button', { name: 'Compra cada mes' })
    fireEvent.click(chip)
    await waitFor(() => expect(cambiarClientes).toHaveBeenCalledWith('e1', ['c1'], true))
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByTestId('etiqueta-nueva'), { target: { value: 'VIP' } })
    fireEvent.submit(screen.getByTestId('etiqueta-nueva').closest('form')!)
    await waitFor(() => expect(guardarLista).toHaveBeenCalledWith(null, 'VIP'))
    await waitFor(() => expect(cambiarClientes).toHaveBeenCalledWith('e2', ['c1'], true))
  })
})

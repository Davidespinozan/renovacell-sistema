// @vitest-environment jsdom
// TEMPORAL · el botón invoca la acción de diagnóstico sin mandar credenciales ni seller_id y muestra solo el resumen mínimo.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DiagnosticoT1Temporal } from './DiagnosticoT1Temporal'
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { functions: { invoke: vi.fn() } } }))
beforeEach(cleanup)
describe('TEMPORAL · diagnóstico T1', () => {
  it('muestra HTTP, success, coincidencia de seller y saldo; nada más', async () => {
    const invocar = vi.fn(async () => ({ ok: true as const, data: { http: 200, success: true, seller_coincide: true, current_balance: 5000, error: null, errorType: null } }))
    render(<DiagnosticoT1Temporal invocar={invocar} />)
    fireEvent.click(screen.getByTestId('diag-t1-correr'))
    await waitFor(() => expect(invocar).toHaveBeenCalledTimes(1))
    expect(invocar.mock.calls[0]).toHaveLength(0)   // sin argumentos: ni llave ni seller_id desde el navegador
    const r = screen.getByTestId('diag-t1-resultado'); expect(r).toHaveTextContent('200'); expect(r).toHaveTextContent('sí'); expect(r).toHaveTextContent('5000')
  })
  it('error sanitizado del servidor', async () => {
    render(<DiagnosticoT1Temporal invocar={async () => ({ ok: true, data: { http: 400, success: false, seller_coincide: null, current_balance: null, error: 'No existe en recurso con id: [número]', errorType: 'NotFound' } })} />)
    fireEvent.click(screen.getByTestId('diag-t1-correr'))
    const r = await screen.findByTestId('diag-t1-resultado'); expect(r).toHaveTextContent('400'); expect(r).toHaveTextContent('no viene en la respuesta'); expect(r).toHaveTextContent('NotFound')
  })
})

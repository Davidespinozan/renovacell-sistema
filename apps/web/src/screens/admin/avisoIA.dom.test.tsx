// @vitest-environment jsdom
// AVISO-IA · Dirección guarda y quita el aviso del asistente; los errores del servidor se dicen en palabras.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { AvisoIAEditor } from './AvisoIAEditor'

afterEach(cleanup)
const leer = (aviso_ia: string | null, aviso_ia_hasta: string | null = null) => () => Promise.resolve({ data: { aviso_ia, aviso_ia_hasta }, error: null })
const TXT = 'La sucursal está cerrada por remodelación; las entregas se coordinan con un asesor.'

describe('Aviso para el asistente', () => {
  it('guarda texto y fecha de fin', async () => {
    const rpc = vi.fn(async () => ({ data: { texto: TXT, hasta: '2026-11-20' }, error: null }))
    render(<AvisoIAEditor rpc={rpc} leer={leer(null)} />)
    fireEvent.change(await screen.findByTestId('aviso-ia-texto'), { target: { value: TXT } })
    fireEvent.change(screen.getByTestId('aviso-ia-hasta'), { target: { value: '2026-11-20' } })
    fireEvent.click(screen.getByTestId('aviso-ia-guardar'))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('ia_aviso_guardar', { p_texto: TXT, p_hasta: '2026-11-20' }))
    expect(await screen.findByTestId('aviso-ia-msg')).toHaveTextContent(/el asistente ya lo toma en cuenta/)
    expect(screen.getByTestId('aviso-ia-vigente')).toHaveTextContent('Vigente hasta el 2026-11-20')
  })
  it('muestra el vigente y lo quita', async () => {
    const rpc = vi.fn(async () => ({ data: { texto: null, hasta: null }, error: null }))
    render(<AvisoIAEditor rpc={rpc} leer={leer(TXT)} />)
    expect(await screen.findByTestId('aviso-ia-vigente')).toHaveTextContent('sin fecha de fin')
    fireEvent.click(screen.getByTestId('aviso-ia-quitar'))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('ia_aviso_guardar', { p_texto: null, p_hasta: null }))
    expect(await screen.findByTestId('aviso-ia-msg')).toHaveTextContent('Aviso quitado.')
  })
  it('error del servidor en palabras', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'FECHA_PASADA: la fecha de fin ya pasó' } }))
    render(<AvisoIAEditor rpc={rpc} leer={leer(null)} />)
    fireEvent.change(await screen.findByTestId('aviso-ia-texto'), { target: { value: TXT } })
    fireEvent.click(screen.getByTestId('aviso-ia-guardar'))
    expect(await screen.findByTestId('aviso-ia-msg')).toHaveTextContent('La fecha de fin ya pasó.')
  })
})

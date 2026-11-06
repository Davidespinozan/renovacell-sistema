// @vitest-environment jsdom
// ASISTENTE DEL EQUIPO · el panel pregunta con el historial de la plática, muestra **negritas** y listas, y explica errores.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { AsistenteEquipo, mensajeError } from './AsistenteEquipo'

afterEach(cleanup)
describe('Pregúntale al sistema', () => {
  it('abre, pregunta, muestra la respuesta y manda el historial en la siguiente', async () => {
    const invocar = vi.fn()
      .mockResolvedValueOnce({ data: { ok: true, respuesta: 'Le tocó a **Alejandra** por reparto:\n- no estaba ligada a su ficha\n- Roberto no la inició a tiempo' }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, respuesta: 'Usa «+ → Vincular a un cliente».' }, error: null })
    render(<AsistenteEquipo invocar={invocar} pantalla="g_conversaciones" />)
    fireEvent.click(screen.getByTestId('ae-abrir'))
    fireEvent.change(screen.getByTestId('ae-texto'), { target: { value: '¿Por qué le tocó a Alejandra?' } })
    fireEvent.click(screen.getByTestId('ae-enviar'))
    await waitFor(() => expect(invocar).toHaveBeenCalledWith('asistente-equipo', { body: { pregunta: '¿Por qué le tocó a Alejandra?', historial: [], pantalla: 'g_conversaciones' } }))
    const r = await screen.findByTestId('ae-msg-asistente')
    expect(r.querySelector('b')?.textContent).toBe('Alejandra')
    expect(r.querySelectorAll('li')).toHaveLength(2)
    fireEvent.change(screen.getByTestId('ae-texto'), { target: { value: '¿Cómo lo arreglo?' } })
    fireEvent.keyDown(screen.getByTestId('ae-texto'), { key: 'Enter' })
    await waitFor(() => expect(invocar).toHaveBeenCalledTimes(2))
    expect((invocar.mock.calls[1][1] as { body: { historial: unknown[] } }).body.historial).toEqual([
      { rol: 'persona', texto: '¿Por qué le tocó a Alejandra?' },
      { rol: 'asistente', texto: 'Le tocó a **Alejandra** por reparto:\n- no estaba ligada a su ficha\n- Roberto no la inició a tiempo' },
    ])
  })
  it('ejemplos de un toque y error del servidor en palabras (no entra al historial)', async () => {
    const invocar = vi.fn().mockResolvedValueOnce({ data: null, error: { context: { status: 429 } } }).mockResolvedValueOnce({ data: { ok: true, respuesta: 'ok' }, error: null })
    render(<AsistenteEquipo invocar={invocar} />)
    fireEvent.click(screen.getByTestId('ae-abrir'))
    fireEvent.click(screen.getAllByTestId('ae-ejemplo')[0])
    expect(await screen.findByText(/muchas preguntas seguidas/)).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('ae-texto'), { target: { value: 'otra' } })
    fireEvent.click(screen.getByTestId('ae-enviar'))
    await waitFor(() => expect(invocar).toHaveBeenCalledTimes(2))
    expect((invocar.mock.calls[1][1] as { body: { historial: unknown[] } }).body.historial).toEqual([{ rol: 'persona', texto: '¿Cómo paso una conversación a otro vendedor?' }])
  })
  it('mensajes de error', () => {
    expect(mensajeError({ context: { status: 501 } })).toMatch(/no está configurado/)
    expect(mensajeError(new Error('x'))).toMatch(/No pude responder/)
  })
})

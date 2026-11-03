// @vitest-environment jsdom
// MIS CLIENTES Y PROSPECTOS (3 nov 2026) · lo que atendí sigue a la vista cuando vuelve a la IA y lo retomo yo misma.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MisClientes } from './MisClientes'
import { retomarConversacion, type MiConversacion } from '../../data/ops/misConversaciones'

afterEach(cleanup)
const fila = (x: Partial<MiConversacion>): MiConversacion => ({ conversation_id: 'C1', dueno: 'WhatsApp …4521 · DRA. KATTYA', modo: 'ai_active', last_message_at: '2026-11-03T16:00:00Z', prospecto: true, canal: 'whatsapp',
  atiende: 'ia', atiende_nombre: null, puede_retomar: true, ultimo: { actor: 'ai', texto: 'Con gusto te cotizo', at: '2026-11-03T16:00:00Z' }, ...x })

describe('Mis clientes y prospectos', () => {
  it('muestra quién la atiende, el último mensaje y retoma con un toque', async () => {
    const retomar = vi.fn(async () => ({ ok: true as const })); const onAbrir = vi.fn()
    render(<MisClientes onAbrir={onAbrir} cargar={async () => [fila({}), fila({ conversation_id: 'C2', dueno: 'Clínica Sol', atiende: 'otro', atiende_nombre: 'Roberto', puede_retomar: false, prospecto: false, canal: null })]} retomar={retomar} />)
    const filas = await screen.findAllByTestId('mi-cliente')
    expect(screen.getByText('Mis clientes y prospectos (2)')).toBeTruthy()
    expect(filas[0]).toHaveTextContent('La atiende el asistente'); expect(filas[0]).toHaveTextContent('Prospecto'); expect(filas[0]).toHaveTextContent('Asistente: Con gusto te cotizo')
    expect(filas[1]).toHaveTextContent('La atiende otra persona: Roberto'); expect(filas[1]).toHaveTextContent('En curso con otra persona')
    expect(filas[1].querySelector('[data-testid="btn-retomar"]')).toBeNull()
    fireEvent.click(screen.getByTestId('btn-retomar'))
    await waitFor(() => expect(onAbrir).toHaveBeenCalledWith('C1'))
    expect(retomar).toHaveBeenCalledWith('C1')
  })
  it('si no se puede retomar, dice por qué y no abre', async () => {
    const onAbrir = vi.fn()
    render(<MisClientes onAbrir={onAbrir} cargar={async () => [fila({})]} retomar={async () => ({ ok: false as const, mensaje: 'No se puede retomar: Roberto la está atendiendo ahora.' })} />)
    fireEvent.click(await screen.findByTestId('btn-retomar'))
    expect(await screen.findByTestId('mis-clientes-error')).toHaveTextContent('Roberto la está atendiendo ahora')
    expect(onAbrir).not.toHaveBeenCalled()
  })
  it('sin conversaciones no ocupa lugar', async () => {
    const { container } = render(<MisClientes onAbrir={() => {}} cargar={async () => []} />)
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })
  it('traduce los rechazos del servidor', async () => {
    const r = await retomarConversacion('C1', async () => ({ data: null, error: { message: 'ATENDIDA_POR_OTRO: Roberto Ibarra la está atendiendo ahora' } }))
    expect(r).toEqual({ ok: false, mensaje: 'No se puede retomar: Roberto Ibarra la está atendiendo ahora.' })
    expect(await retomarConversacion('C1', async () => ({ data: null, error: { message: 'NO_AUTORIZADO: no es tu cliente' } }))).toEqual({ ok: false, mensaje: 'Esa conversación ya no es de tu cartera.' })
  })
})

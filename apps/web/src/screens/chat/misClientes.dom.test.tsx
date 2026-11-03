// @vitest-environment jsdom
// MIS CLIENTES Y PROSPECTOS (3 nov 2026) · lo que atendí sigue en MI lista de Conversaciones (la misma de las asesorías)
// cuando vuelve al asistente, y lo retomo yo misma.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { FilaMiCliente } from './MisClientes'
import { Asesorias } from './Asesorias'
import { ClienteChat } from '../../data/ops/chat'
import * as ops from '../../data/ops/misConversaciones'
import { retomarConversacion, type MiConversacion } from '../../data/ops/misConversaciones'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const fila = (x: Partial<MiConversacion>): MiConversacion => ({ conversation_id: 'C1', dueno: 'WhatsApp …4521 · DRA. KATTYA', modo: 'ai_active', last_message_at: '2026-11-03T16:00:00Z', prospecto: true, canal: 'whatsapp',
  atiende: 'ia', atiende_nombre: null, puede_retomar: true, ultimo: { actor: 'ai', texto: 'Con gusto te cotizo', at: '2026-11-03T16:00:00Z' }, ...x })
const enLista = (n: React.ReactNode) => render(<ul>{n}</ul>)

describe('Mis clientes y prospectos en Conversaciones', () => {
  it('van en la MISMA lista que las asesorías, con "Retomar"', async () => {
    vi.spyOn(ops, 'misConversaciones').mockResolvedValue([fila({})])
    const c = new ClienteChat(async (_f, { body }) => ({ data: body.action === 'cola' ? { cola: [] } : { ok: true }, error: null }), () => null)
    render(<Asesorias cliente={c} intervaloMs={600_000} contactoDe={async () => null} />)
    expect(await screen.findByText('Mis conversaciones (1)')).toBeTruthy()
    expect(screen.getByTestId('mi-cliente')).toHaveTextContent('La atiende el asistente')
    expect(screen.queryByText('No hay conversaciones esperando asesor.')).toBeNull()
  })
  it('la fila dice quién la atiende y el último mensaje; retoma con un toque', async () => {
    const retomar = vi.fn(async () => ({ ok: true as const })); const onAbrir = vi.fn()
    enLista(<>
      <FilaMiCliente c={fila({})} onAbrir={onAbrir} onError={() => {}} retomar={retomar} />
      <FilaMiCliente c={fila({ conversation_id: 'C2', dueno: 'Clínica Sol', atiende: 'otro', atiende_nombre: 'Roberto', puede_retomar: false, prospecto: false, canal: null })} onAbrir={onAbrir} onError={() => {}} />
    </>)
    const filas = screen.getAllByTestId('mi-cliente')
    expect(filas[0]).toHaveTextContent('Prospecto'); expect(filas[0]).toHaveTextContent('Asistente: Con gusto te cotizo')
    expect(filas[1]).toHaveTextContent('La atiende otra persona: Roberto'); expect(filas[1]).toHaveTextContent('En curso con otra persona')
    fireEvent.click(screen.getByTestId('btn-retomar'))
    await waitFor(() => expect(onAbrir).toHaveBeenCalledWith('C1'))
    expect(retomar).toHaveBeenCalledWith('C1')
  })
  it('si no se puede retomar, dice por qué y no abre', async () => {
    const onAbrir = vi.fn(); const onError = vi.fn()
    enLista(<FilaMiCliente c={fila({})} onAbrir={onAbrir} onError={onError} retomar={async () => ({ ok: false as const, mensaje: 'No se puede retomar: Roberto la está atendiendo ahora.' })} />)
    fireEvent.click(screen.getByTestId('btn-retomar'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('No se puede retomar: Roberto la está atendiendo ahora.'))
    expect(onAbrir).not.toHaveBeenCalled()
  })
  it('traduce los rechazos del servidor', async () => {
    expect(await retomarConversacion('C1', async () => ({ data: null, error: { message: 'ATENDIDA_POR_OTRO: Roberto Ibarra la está atendiendo ahora' } }))).toEqual({ ok: false, mensaje: 'No se puede retomar: Roberto Ibarra la está atendiendo ahora.' })
    expect(await retomarConversacion('C1', async () => ({ data: null, error: { message: 'NO_AUTORIZADO: no es tu cliente' } }))).toEqual({ ok: false, mensaje: 'Esa conversación ya no es de tu cartera.' })
  })
})

// @vitest-environment jsdom
// MIS CLIENTES Y PROSPECTOS → CONV-WHATSAPP (14 nov 2026) · una sola lista como WhatsApp (la más reciente arriba, con
// nombre, número y último mensaje); tocar abre el chat SIN retomar; escribir retoma; terminar no echa a su vendedora.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { Asesorias } from './Asesorias'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, type ColaItem, type Conversacion } from '../../data/ops/chat'
import * as ops from '../../data/ops/misConversaciones'
import { retomarConversacion, type MiConversacion } from '../../data/ops/misConversaciones'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const fila = (x: Partial<MiConversacion>): MiConversacion => ({ conversation_id: 'C1', dueno: 'Kattya López', telefono: '+5215554649850', modo: 'ai_active', last_message_at: '2026-11-03T16:00:00Z', prospecto: true, canal: 'whatsapp',
  atiende: 'ia', atiende_nombre: null, puede_retomar: true, ultimo: { actor: 'ai', texto: 'Con gusto te cotizo', at: '2026-11-03T16:00:00Z' }, ...x })
const enCola = (x: Partial<ColaItem>): ColaItem => ({ conversation_id: 'C9', modo: 'human_active', seller_profile_id: 'S1', asesoria_solicitada_at: null, last_message_at: '2026-11-03T10:00:00Z', es_mia: true, sin_leer: 2, dueno: 'Dra. Ruiz', telefono: '+5216671112233', canal: 'whatsapp',
  ultimo: { actor: 'doctor', texto: 'Hola, ¿tienen exosomas?', at: '2026-11-03T10:00:00Z' }, ...x })

function clienteFalso(conv: Partial<Conversacion>, cola: ColaItem[] = []) {
  const llamadas: Array<{ fn: string; args: unknown[] }> = []
  const c = new ClienteChat(async (_f, { body }) => {
    llamadas.push({ fn: String(body.action), args: [body.conversation_id, body.content] })
    if (body.action === 'cola') return { data: { cola }, error: null }
    if (body.action === 'leer') return { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', ultimo_seq: 1, rol: 'responsable', mensajes: [], ...conv }, error: null }
    if (body.action === 'enviar') return { data: { id: 'm', seq: 2, idempotente: false, modo: 'human_active', ia: 'silenciada' }, error: null }
    return { data: { ok: true }, error: null }
  }, () => null)
  return { c, llamadas }
}

describe('Conversaciones como WhatsApp', () => {
  it('UNA lista: la más reciente arriba, con nombre, número y último mensaje; nunca "Visitante"', async () => {
    vi.spyOn(ops, 'misConversaciones').mockResolvedValue([fila({})])
    const f = clienteFalso({}, [enCola({})])
    render(<Asesorias cliente={f.c} intervaloMs={600_000} contactoDe={async () => null} />)
    await waitFor(() => expect(screen.getAllByTestId('abrir-conversacion')).toHaveLength(2))
    const filas = screen.getByTestId('lista-conversaciones').querySelectorAll('li')
    expect(filas[0]).toHaveTextContent('Kattya López'); expect(filas[0]).toHaveTextContent('+52 555 464 9850'); expect(filas[0]).toHaveTextContent('Asistente: Con gusto te cotizo')
    expect(filas[1]).toHaveTextContent('Dra. Ruiz'); expect(filas[1]).toHaveTextContent('Hola, ¿tienen exosomas?'); expect(filas[1].querySelector('[data-testid="sin-leer"]')!.textContent).toBe('2')
    expect(screen.queryByText(/Visitante/)).toBeNull()
  })
  it('tocar la fila abre el chat SIN retomar (solo leer)', async () => {
    vi.spyOn(ops, 'misConversaciones').mockResolvedValue([fila({})])
    const retomar = vi.spyOn(ops, 'retomarConversacion')
    const f = clienteFalso({})
    render(<Asesorias cliente={f.c} intervaloMs={600_000} contactoDe={async () => null} />)
    fireEvent.click(await screen.findByTestId('abrir-conversacion'))
    expect(await screen.findByTestId('chat-canonico')).toBeTruthy()
    expect(retomar).not.toHaveBeenCalled()
  })
  it('responsable: el número en el encabezado; escribir retoma y luego manda', async () => {
    const retomar = vi.fn(async () => ({ ok: true as const }))
    const f = clienteFalso({ contacto: { nombre: 'Alejandra Quiñonez', telefono: '+5216678675738', canal: 'whatsapp' } })
    render(<ChatCanonico asesor embebido conversationId="C1" cliente={f.c} conCarrito={false} respuestas={null} suscribir={null} intervaloMs={600_000} retomar={retomar} />)
    expect(await screen.findByTestId('chat-telefono')).toHaveTextContent('+52 667 867 5738')
    expect(screen.getByText('Alejandra Quiñonez')).toBeTruthy()
    const caja = screen.getByLabelText('Escribe tu mensaje') as HTMLTextAreaElement
    expect(caja.placeholder).toMatch(/retomar/)
    fireEvent.change(caja, { target: { value: 'Hola' } }); fireEvent.click(screen.getByTestId('btn-enviar'))
    await waitFor(() => expect(f.llamadas.some((l) => l.fn === 'enviar')).toBe(true))
    expect(retomar).toHaveBeenCalledWith('C1')
  })
  it('si no se puede retomar, el mensaje no sale y dice por qué', async () => {
    const f = clienteFalso({})
    render(<ChatCanonico asesor embebido conversationId="C1" cliente={f.c} conCarrito={false} respuestas={null} suscribir={null} intervaloMs={600_000}
      retomar={async () => ({ ok: false as const, mensaje: 'No se puede retomar: Roberto la está atendiendo ahora.' })} />)
    const caja = await screen.findByLabelText('Escribe tu mensaje')
    await waitFor(() => expect(caja).not.toBeDisabled())
    fireEvent.change(caja, { target: { value: 'Hola' } }); fireEvent.click(screen.getByTestId('btn-enviar'))
    expect(await screen.findByText(/No se envió/)).toBeTruthy()
    expect(f.llamadas.some((l) => l.fn === 'enviar')).toBe(false)
  })
  it('traduce los rechazos del servidor', async () => {
    expect(await retomarConversacion('C1', async () => ({ data: null, error: { message: 'ATENDIDA_POR_OTRO: Roberto Ibarra la está atendiendo ahora' } }))).toEqual({ ok: false, mensaje: 'No se puede retomar: Roberto Ibarra la está atendiendo ahora.' })
    expect(await retomarConversacion('C1', async () => ({ data: null, error: { message: 'NO_AUTORIZADO: no es tu cliente' } }))).toEqual({ ok: false, mensaje: 'Esa conversación ya no es de tu cartera.' })
  })
})

// @vitest-environment jsdom
// RR-FOTOS (24 nov 2026) · una respuesta rápida con fotos: al elegirla se avisa que van fotos; al enviar sale el texto y
// después cada foto por el mismo camino que el botón de fotos (adjuntar), a la misma conversación. Se pueden quitar.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'
import type { ClienteRespuestas, RespuestaRapida } from '../../data/ops/respuestasRapidas'
import mig from '../../../../../supabase/migrations/20270407910000_respuestas_con_fotos.sql?raw'

afterEach(cleanup)
const conv = (): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'human_active', rol: 'asesor', ultimo_seq: 0, mensajes: [] })
const R: RespuestaRapida = { id: 'r1', profile_id: 'u1', titulo: 'Catálogo', texto: 'Hola {nombre}, te comparto fotos', orden: 1, fotos: ['u1/a.jpg', 'u1/b.jpg'] }
const montar = (llamadas: Array<Record<string, unknown>>) => {
  const cliente = new ClienteChat(async (_f, { body }) => {
    llamadas.push(body)
    if (body.action === 'leer') return { data: conv(), error: null }
    if (body.action === 'enviar' || body.action === 'adjuntar') return { data: { id: 'm', seq: 1, idempotente: false, modo: 'human_active', ia: 'omitida' }, error: null }
    return { data: { ok: true }, error: null }
  }, () => null)
  const respuestas: ClienteRespuestas = {
    listar: vi.fn(async () => [R]), guardar: vi.fn(async () => ({ ok: true as const })), borrar: vi.fn(async () => ({ ok: true as const })),
    comoDataUrl: vi.fn(async (ruta: string) => `data:image/jpeg;base64,${ruta === 'u1/a.jpg' ? 'QQ==' : 'Qg=='}`),
  }
  render(<ChatCanonico cliente={cliente} asesor conversationId="C1" nombreCliente="Dra. Ana Ruiz" respuestas={respuestas} conCarrito={false} intervaloMs={600_000} suscribir={null} />)
}

describe('respuestas rápidas con fotos', () => {
  it('elegirla avisa las fotos; al enviar sale el texto y luego las 2 fotos a la misma conversación', async () => {
    const llamadas: Array<Record<string, unknown>> = []
    montar(llamadas)
    fireEvent.click(await screen.findByTestId('btn-respuestas'))
    expect((await screen.findByTestId('rr-item-fotos')).textContent).toMatch(/2/)
    fireEvent.click(screen.getByTestId('rr-item'))
    expect(screen.getByTestId('rr-fotos-pendientes').textContent).toMatch(/Van 2 fotos/)
    fireEvent.click(screen.getByTestId('btn-enviar'))
    await waitFor(() => expect(llamadas.filter((b) => b.action === 'adjuntar').length).toBe(2))
    const orden = llamadas.filter((b) => b.action === 'enviar' || b.action === 'adjuntar')
    expect(orden.map((b) => b.action)).toEqual(['enviar', 'adjuntar', 'adjuntar'])
    expect(orden[0]).toMatchObject({ conversation_id: 'C1', content: 'Hola Ana, te comparto fotos' })
    expect(orden[1]).toMatchObject({ conversation_id: 'C1', imagen: 'data:image/jpeg;base64,QQ==' })
    expect(screen.queryByTestId('rr-fotos-pendientes')).toBeNull()
  })
  it('se pueden quitar antes de enviar: sale solo el texto', async () => {
    const llamadas: Array<Record<string, unknown>> = []
    montar(llamadas)
    fireEvent.click(await screen.findByTestId('btn-respuestas'))
    fireEvent.click(await screen.findByTestId('rr-item'))
    fireEvent.click(screen.getByTestId('rr-fotos-quitar'))
    fireEvent.click(screen.getByTestId('btn-enviar'))
    await waitFor(() => expect(llamadas.some((b) => b.action === 'enviar')).toBe(true))
    expect(llamadas.some((b) => b.action === 'adjuntar')).toBe(false)
  })
  it('servidor: hasta 4 fotos ya subidas, carpeta propia, null conserva y solo admin/ventas las leen', () => {
    expect(mig).toMatch(/jsonb_array_length\(fotos\) <= 4/)
    expect(mig).toMatch(/split_part\(name, '\/', 1\) = auth\.uid\(\)::text/)
    expect(mig).toMatch(/fotos = coalesce\(p_fotos, fotos\)/)
    expect(mig).toMatch(/respuestas_fotos_leer[\s\S]*auth_role\(\) in \('admin', 'pos'\)/)
    expect(mig).toMatch(/revoke all on function public\.cc_respuesta_guardar\(uuid, text, text, boolean, jsonb\) from public, anon/)
  })
})

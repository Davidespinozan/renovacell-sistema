// @vitest-environment jsdom
// CHAT PRO · "escribiendo…" en los dos sentidos, respuestas rápidas del personal, unir la conversación del enlace a una
// cuenta registrada en otro dispositivo y "Hablar con mi asesor" desde la franja de verificación.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { PanelVerificacion } from './PanelVerificacion'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'
import { aplicarNombre, filtrar, RESPUESTAS_BASE, type ClienteRespuestas } from '../../data/ops/respuestasRapidas'
import { EVENTO_ABRIR_CHAT, pedirAbrirChat } from '../../data/store/chatUiStore'
import type { DoctorPendiente } from '../../data/ops/verificacion'
import { escribiendoAhora } from '../../../../../supabase/functions/_shared/adjuntos'
import chatEdge from '../../../../../supabase/functions/chat/index.ts?raw'
import mig from '../../../../../supabase/migrations/20261214120000_chat_pro.sql?raw'

afterEach(cleanup)
const conv = (extra: Partial<Conversacion> = {}): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: 0, mensajes: [], ...extra })
const clienteCon = (leer: () => Conversacion, llamadas: Array<Record<string, unknown>> = []) => new ClienteChat(async (_f, { body }) => {
  llamadas.push(body)
  if (body.action === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null }
  return { data: body.action === 'leer' ? leer() : { ok: true }, error: null }
}, () => null)
const respuestasFalsas = (): ClienteRespuestas => ({ listar: vi.fn(async () => RESPUESTAS_BASE), guardar: vi.fn(async () => ({ ok: true as const })), borrar: vi.fn(async () => ({ ok: true as const })) })

describe('"Escribiendo…"', () => {
  it('el cliente ve que su asesora escribe (encabezado y burbuja), sin confundirlo con el asistente', async () => {
    render(<ChatCanonico cliente={clienteCon(() => conv({ modo: 'human_active', asesor_nombre: 'Lucía Ramos', escribiendo_otro: true }))} conCarrito={false} intervaloMs={600_000} suscribir={null} />)
    expect((await screen.findByTestId('otro-escribiendo')).getAttribute('aria-label')).toBe('Lucía está escribiendo')
    expect(screen.getByTestId('chat-modo').textContent).toBe('escribiendo…')
  })
  it('el personal ve que el cliente escribe; sin la señal, el encabezado vuelve a su estado', async () => {
    let escribe = true
    render(<ChatCanonico cliente={clienteCon(() => conv({ rol: 'asesor', modo: 'human_active', escribiendo_otro: escribe }))} asesor conversationId="C1" nombreCliente="Dra. Magaly Pérez" respuestas={null} conCarrito={false} intervaloMs={40} suscribir={null} />)
    expect((await screen.findByTestId('otro-escribiendo')).getAttribute('aria-label')).toBe('Magaly está escribiendo')
    escribe = false
    await waitFor(() => expect(screen.queryByTestId('otro-escribiendo')).toBeNull())
    expect(screen.getByTestId('chat-modo').textContent).not.toBe('escribiendo…')
  })
  it('al teclear avisa al servidor como mucho una vez cada 3 s y nunca manda el texto', async () => {
    const llamadas: Array<Record<string, unknown>> = []
    render(<ChatCanonico cliente={clienteCon(() => conv(), llamadas)} conCarrito={false} intervaloMs={600_000} suscribir={null} />)
    const area = await screen.findByLabelText('Escribe tu mensaje')
    await waitFor(() => expect((area as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.change(area, { target: { value: 'Ho' } }); fireEvent.change(area, { target: { value: 'Hola' } }); fireEvent.change(area, { target: { value: 'Hola, ¿tienen…' } })
    await waitFor(() => expect(llamadas.filter((b) => b.action === 'escribiendo').length).toBe(1))
    const ping = llamadas.find((b) => b.action === 'escribiendo')!
    expect(ping).toMatchObject({ conversation_id: 'C1', activo: true }); expect(JSON.stringify(ping)).not.toMatch(/Hola/)
  })
  it('servidor: la señal vence sola, se apaga al enviar y la base la autoriza como leer', () => {
    const ahora = Date.parse('2026-10-15T12:00:00Z')
    expect(escribiendoAhora(['2026-10-15T12:00:04Z', null], ahora)).toBe(true)
    expect(escribiendoAhora(['2026-10-15T11:59:59Z', null], ahora)).toBe(false)
    expect(escribiendoAhora([], ahora)).toBe(false)
    const enviar = chatEdge.slice(chatEdge.indexOf("if (action === 'enviar')"), chatEdge.indexOf("if (action === 'adjuntar')"))
    expect(enviar).toMatch(/cc_escribiendo', \{ \.\.\.base, p_activo: false \}/)
    expect(mig).toMatch(/perform public\._cc_autoridad\(p_conv, p_actor_type, v_visitor, p_profile\)/)
    expect(mig).toMatch(/revoke all on function public\.cc_escribiendo\(uuid, text, text, uuid, boolean\) from public, anon, authenticated/)
  })
})

describe('Respuestas rápidas (personal)', () => {
  const montar = (respuestas = respuestasFalsas()) => {
    render(<ChatCanonico cliente={clienteCon(() => conv({ rol: 'asesor', modo: 'human_active' }))} asesor conversationId="C1" nombreCliente="Dra. Magaly Pérez" respuestas={respuestas} conCarrito={false} intervaloMs={600_000} suscribir={null} />)
    return respuestas
  }
  it('el botón abre la lista y elegir pone el texto con el nombre del cliente, editable antes de enviar', async () => {
    montar()
    fireEvent.click(await screen.findByTestId('btn-respuestas'))
    fireEvent.click((await screen.findAllByTestId('rr-item'))[0])
    expect((screen.getByLabelText('Escribe tu mensaje') as HTMLTextAreaElement).value).toBe('Hola Magaly, gracias por escribir a Renovacell. ¿En qué te puedo ayudar?')
    expect(screen.queryByTestId('respuestas-rapidas')).toBeNull()
  })
  it('escribir "/" busca; flechas y Enter eligen; Escape cierra y limpia', async () => {
    montar()
    const area = await screen.findByLabelText('Escribe tu mensaje') as HTMLTextAreaElement
    await waitFor(() => expect(area.disabled).toBe(false))
    fireEvent.change(area, { target: { value: '/ine' } })
    expect(screen.getAllByTestId('rr-item').map((b) => b.textContent)).toEqual([expect.stringMatching(/^Fotos del INE/)])
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(area.value).toMatch(/^¿Me compartes por aquí una foto del frente/)
    fireEvent.change(area, { target: { value: '/' } })
    fireEvent.keyDown(area, { key: 'ArrowDown' }); fireEvent.keyDown(area, { key: 'Enter' })
    expect(area.value).toMatch(/^Para ver precios/)
    fireEvent.change(area, { target: { value: '/desp' } }); fireEvent.keyDown(area, { key: 'Escape' })
    expect(area.value).toBe(''); expect(screen.queryByTestId('respuestas-rapidas')).toBeNull()
  })
  it('administrar: un vendedor crea las suyas (no las de la empresa)', async () => {
    const r = montar()
    fireEvent.click(await screen.findByTestId('btn-respuestas'))
    fireEvent.click(screen.getByTestId('rr-administrar'))
    expect(screen.queryAllByTestId('rr-borrar')).toHaveLength(0)   // las 7 son de la empresa: el vendedor no las toca
    fireEvent.click(screen.getByTestId('rr-nueva'))
    expect(screen.queryByText('Para todo el equipo')).toBeNull()
    fireEvent.change(screen.getByTestId('rr-titulo'), { target: { value: 'Horario' } })
    fireEvent.change(screen.getByTestId('rr-texto'), { target: { value: 'Atiendo de 10 a 18 h' } })
    fireEvent.click(screen.getByTestId('rr-guardar'))
    await waitFor(() => expect(r.guardar).toHaveBeenCalledWith({ titulo: 'Horario', texto: 'Atiendo de 10 a 18 h', empresa: false }))
    await waitFor(() => expect(r.listar).toHaveBeenCalledTimes(2))
  })
  it('el cliente nunca ve respuestas rápidas', async () => {
    render(<ChatCanonico cliente={clienteCon(() => conv())} respuestas={respuestasFalsas()} conCarrito={false} intervaloMs={600_000} suscribir={null} />)
    await screen.findByTestId('btn-imagen')
    expect(screen.queryByTestId('btn-respuestas')).toBeNull()
  })
  it('{nombre} sin nombre no deja huecos; el filtro ignora acentos', () => {
    expect(aplicarNombre('Hola {nombre}, gracias', null)).toBe('Hola, gracias')
    expect(aplicarNombre('Gracias {nombre}, quedo al pendiente', 'Dr. Juan López')).toBe('Gracias Juan, quedo al pendiente')
    expect(filtrar(RESPUESTAS_BASE, 'VERIFICACION').map((r) => r.titulo)).toContain('Verificación')
  })
  it('base: RLS por dueño; la empresa solo la edita Dirección', () => {
    expect(mig).toMatch(/create policy cc_rr_ver[\s\S]*profile_id is null or profile_id = auth\.uid\(\)/)
    expect(mig).toMatch(/r\.profile_id is not distinct from v_uid or \(r\.profile_id is null and v_rol = 'admin'\)/); expect(mig).toMatch(/grant select on table public\.cc_respuestas_rapidas to authenticated;/)
  })
})

describe('Unir la conversación del enlace (otro dispositivo)', () => {
  const P = '11111111-1111-4111-8111-111111111111'
  const doc: DoctorPendiente = { profile_id: P, nombre: 'Dra. Otro Equipo', email: 'otro@x.mx', telefono: '6690000201', organizacion: null, cedula: '1234567', verificado: false, estado: 'pending', sep: null, identidad: 'pending', evidencia: {} } as unknown as DoctorPendiente
  it('quien lo atiende ve la conversación que coincide y la une con un clic', async () => {
    const unir = vi.fn().mockResolvedValue({ ok: true })
    const onCambio = vi.fn()
    render(<PanelVerificacion conversationId="C1" leer={async () => doc} evidencia={async () => ({})} onCambio={onCambio}
      candidatos={async () => [{ visitor_id: 'V1', nombre: 'Dra. Otro Equipo', telefono: '6690000201', email: 'otro.correo@x.mx', creado: '2026-10-14T10:00:00Z', coincide: 'celular', mensajes: 3 }]} unir={unir} />)
    expect((await screen.findByTestId('candidato-enlace')).textContent).toMatch(/3 mensajes; coincide por celular/)
    fireEvent.click(screen.getByTestId('btn-unir-enlace'))
    await waitFor(() => expect(unir).toHaveBeenCalledWith(P, 'V1'))
    await waitFor(() => expect(screen.queryByTestId('candidato-enlace')).toBeNull())
    expect(onCambio).toHaveBeenCalled()
  })
  it('base: solo une lo que coincide por correo o celular y solo quien lo atiende', () => {
    expect(mig).toMatch(/NO_COINCIDE/)
    expect(mig.match(/if not public\._puede_verificar\(p_profile\)/g)?.length).toBe(2)
  })
})

describe('"Hablar con mi asesor" desde la franja de verificación', () => {
  it('pide abrir el chat flotante (apertura manual por un clic de la persona)', () => {
    const oido = vi.fn()
    window.addEventListener(EVENTO_ABRIR_CHAT, oido)
    pedirAbrirChat()
    window.removeEventListener(EVENTO_ABRIR_CHAT, oido)
    expect(oido).toHaveBeenCalledTimes(1)
  })
})

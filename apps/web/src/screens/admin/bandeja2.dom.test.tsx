// @vitest-environment jsdom
// BANDEJA-2 · bandeja única de Dirección: lista por lo que hay que hacer (Por atender · En atención · IA · Todas) con
// conteos, búsqueda, filtro de origen; al elegir una conversación se abre a la derecha con sus acciones (asignar sin
// asesor); "Canales y horario" agrupa enlace, horario y controles de la IA. Servidor FALSO.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { BandejaConversaciones, estadoLinea, telefono, hace } from './BandejaConversaciones'
import { ClienteAtencion, type ItemBandeja } from '../../data/ops/atencion'
import { ClienteChat } from '../../data/ops/chat'
import { ClienteCanalOperacion } from '../../data/ops/canalOperacion'

afterEach(cleanup)
const it0 = (o: Partial<ItemBandeja>): ItemBandeja => ({ conversation_id: 'x', grupo: 'ia', modo: 'ai_active', dueno: 'visitante', profile_id: null, nombre: 'Visitante', seller_id: null, seller_nombre: null,
  tomada: false, ruteo_motivo: null, origen: null, fuera_horario: false, solicitado_at: null, edad_min: null, iniciada: false, cart_id: null, n_items: 0, sin_responder: false, ultimo_actor: 'ai', hace_min: 5, atencion: null, contacto: null, ...o })
const ITEMS: ItemBandeja[] = [
  it0({ conversation_id: 'mj', grupo: 'por_atender', modo: 'human_requested', edad_min: 60, hace_min: 60, contacto: { fuente: 'whatsapp', nombre: 'Dra.Maria Jose Vea C.', detalle: '+5216871605335', ultimo_texto: 'La wegovy', ultimo_at: null } }),
  it0({ conversation_id: 'st', grupo: 'por_atender', modo: 'ai_active', sin_responder: true, ultimo_actor: 'visitor', hace_min: 15, contacto: { fuente: 'instagram', nombre: 'Clínica Sol', detalle: null, ultimo_texto: '¿tienen nabota?', ultimo_at: null } }),
  it0({ conversation_id: 'y', grupo: 'en_atencion', modo: 'human_active', seller_id: 's1', seller_nombre: 'Lucía · Ventas', contacto: { fuente: 'whatsapp', nombre: 'Y', detalle: '+5215551917633', ultimo_texto: 'No gracias', ultimo_at: null } }),
  it0({ conversation_id: 'pt', grupo: 'ia', dueno: 'doctor', profile_id: 'p1', nombre: 'Juan Pérez', contacto: { fuente: 'portal', nombre: null, detalle: null, ultimo_texto: '¿Tienen Nabota de 200?', ultimo_at: null } }),
]
function servidor() {
  const llamadas: Array<{ fn: string; args?: unknown }> = []
  const rpc = async (fn: string, args?: unknown) => {
    llamadas.push({ fn, args })
    if (fn === 'cc_bandeja_unificada') return { data: { resumen: { por_atender: 2, en_atencion: 1, ia: 1, todas: 4 }, conversaciones: ITEMS }, error: null }
    if (fn === 'cc_vendedores') return { data: [{ id: 's1', nombre: 'Lucía · Ventas', activo: true, elegible: true, elegible_nuevos: true, conversaciones: true, nuevos_clientes: true, clientes: 3 }], error: null }
    if (fn === 'cc_ruteo_pendientes') return { data: { resumen: { horario: { configurado: true, abierto: true, zona: 'America/Mazatlan', motivo: '' }, sin_vendedor: 0, reasignacion: 0, handoffs_sin_asignar: 0, handoffs_pendientes: 0, vendedores_elegibles: 3 }, conversaciones: [], carritos_pendientes: [] }, error: null }
    if (fn === 'cc_canal_estado') return { data: { activacion_disponible: true, canales: [{ canal: 'whatsapp', modo: 'activo', ia_habilitada: true, envio_pausado: false, updated_at: null }], historial: [], prueba: null }, error: null }
    return { data: null, error: null }
  }
  const chatLlamadas: Array<Record<string, unknown>> = []
  const conv = { conversation_id: 'mj', estado: 'abierta', modo: 'human_requested', rol: 'supervisor', ultimo_seq: 1, mensajes: [{ id: 'm1', seq: 1, actor: 'visitor', content: 'La wegovy', created_at: new Date().toISOString(), propio: false }] }
  const chat = new ClienteChat((async (_f: string, { body }: { body: Record<string, unknown> }) => { chatLlamadas.push(body); return { data: body.action === 'leer' ? conv : { ok: true }, error: null } }) as never, () => null)
  return { rpc, llamadas, chat, chatLlamadas }
}
const montar = (s = servidor()) => { render(<BandejaConversaciones cliente={new ClienteAtencion(s.rpc as never, vi.fn())} chat={s.chat} canalOp={new ClienteCanalOperacion(s.rpc as never, vi.fn())} intervaloMs={600_000} />); return s }

describe('estado en una línea', () => {
  it('sin asesor, sin respuesta, atendida, IA', () => {
    expect(estadoLinea(ITEMS[0]).texto).toBe('Sin asesor · esperando 1 h'); expect(estadoLinea(ITEMS[0]).tono).toBe('dang')
    expect(estadoLinea(ITEMS[1]).texto).toBe('El cliente quedó sin respuesta')
    expect(estadoLinea(ITEMS[2]).texto).toBe('Atiende Lucía · Ventas')
    expect(estadoLinea(ITEMS[3]).texto).toBe('IA atendiendo')
    expect(telefono('+5216871605335')).toBe('+52 687 160 5335'); expect(hace(90)).toBe('2 h'); expect(hace(0)).toBe('ahora')
  })
})

describe('<BandejaConversaciones>', () => {
  it('abre en "Por atender" con conteos, lo urgente primero; las pestañas cambian la lista', async () => {
    montar()
    await waitFor(() => expect(screen.getAllByTestId('bq-item')).toHaveLength(2))
    expect(screen.getAllByTestId('bq-item')[0]).toHaveTextContent('Dra.Maria Jose Vea C.')
    expect(screen.getAllByTestId('bq-item')[0]).toHaveTextContent('«La wegovy»')
    expect(screen.getByTestId('bq-vista-por_atender')).toHaveTextContent('Por atender2')
    fireEvent.click(screen.getByTestId('bq-vista-en_atencion'))
    expect(screen.getAllByTestId('bq-item')).toHaveLength(1); expect(screen.getByTestId('bq-estado')).toHaveTextContent('Atiende Lucía · Ventas')
    fireEvent.click(screen.getByTestId('bq-vista-todas'))
    expect(screen.getAllByTestId('bq-item')).toHaveLength(4)
  })
  it('búsqueda y filtro de origen', async () => {
    montar()
    await screen.findAllByTestId('bq-item')
    fireEvent.click(screen.getByTestId('bq-vista-todas'))
    fireEvent.change(screen.getByTestId('bq-busca'), { target: { value: 'nabota' } })
    expect(screen.getAllByTestId('bq-item')).toHaveLength(2)
    fireEvent.change(screen.getByTestId('bq-fuente'), { target: { value: 'portal' } })
    expect(screen.getAllByTestId('bq-item')).toHaveLength(1); expect(screen.getByTestId('bq-item')).toHaveTextContent('Juan Pérez')
  })
  it('al elegir una conversación se abre a la derecha; sin asesor se asigna desde ahí', async () => {
    const s = montar()
    fireEvent.click((await screen.findAllByTestId('bq-item'))[0])
    const panel = await screen.findByTestId('bq-panel')
    expect(within(panel).getByTestId('bq-panel-nombre')).toHaveTextContent('Dra.Maria Jose Vea C. · sin cuenta')
    expect(panel).toHaveTextContent('+52 687 160 5335')
    const sel = await within(panel).findByRole('combobox', { name: 'Vendedor para esta conversación' })
    await waitFor(() => expect(within(sel).getAllByRole('option').length).toBeGreaterThan(1))
    fireEvent.change(sel, { target: { value: 's1' } })
    fireEvent.click(within(panel).getByTestId('bq-asignar'))
    await waitFor(() => expect(s.chatLlamadas.some((b) => b.action === 'asignar' && b.conversation_id === 'mj' && b.seller === 's1')).toBe(true))
  })
  it('"Canales y horario" agrupa enlace de contacto, horario y controles de la IA', async () => {
    montar()
    fireEvent.click(await screen.findByTestId('bq-ajustes'))
    const m = await screen.findByTestId('bq-modal-ajustes')
    expect(await within(m).findByTestId('bq-horario')).toHaveTextContent(/horario/i)
    expect(m.textContent).toMatch(/Enlace de contacto/)
  })
})

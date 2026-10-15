// @vitest-environment jsdom
// CC-7 · UI del handoff comercial: aviso veraz al doctor + rechazo; Asesorías por rol (vendedor ve lo
// suyo con contexto; Dirección asigna en Atención comercial); asignación de cartera; horario.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { Asesorias } from './Asesorias'
import { AtencionComercial } from '../admin/AtencionComercial'
import { HorarioAtencion } from '../admin/HorarioAtencion'
import type { ClienteChat, Conversacion, ColaItem } from '../../data/ops/chat'
import type { BandejaWhatsApp, ClienteAtencion, Horario, Pendientes } from '../../data/ops/atencion'

vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: 'admin', setScreen: vi.fn() }) }))
beforeEach(cleanup)

const ok = <T,>(data: T) => ({ ok: true as const, data })
function chatFalso(conv: Partial<Conversacion>, cola: ColaItem[] = []) {
  const llamadas: Array<{ fn: string; args: unknown[] }> = []
  const reg = (fn: string, data: unknown = {}) => async (...args: unknown[]) => { llamadas.push({ fn, args }); return ok(data) }
  const c = {
    abrir: reg('abrir', { conversation_id: 'C1', estado: 'abierta', modo: conv.modo, nuevo: false }),
    leer: reg('leer', { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', ultimo_seq: 0, mensajes: [], rol: 'dueno', ...conv }),
    leido: reg('leido'), enviar: reg('enviar'), solicitarAsesor: reg('solicitarAsesor'), rechazarAsesor: reg('rechazarAsesor', { rechazado: true, modo: 'ai_active' }),
    reanudarIA: reg('reanudarIA'), iniciar: reg('iniciar'), terminar: reg('terminar'), liberar: reg('liberar'), cerrar: reg('cerrar'), asignar: reg('asignar'),
    cola: reg('cola', { cola }),
  } as unknown as ClienteChat
  return { c, llamadas }
}

describe('ChatCanonico · aviso de atención humana (doctor)', () => {
  it('CI-2 · sin asignar: "ya avisé al equipo comercial"; la IA sigue; botón para rechazar al asesor', async () => {
    const f = chatFalso({ modo: 'human_requested', handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: false, asignado: false, puede_rechazar: true } })
    render(<ChatCanonico cliente={f.c} conCarrito={false} intervaloMs={60_000} />)
    expect(await screen.findByTestId('aviso-handoff')).toHaveTextContent('Nuestro equipo comercial ya tiene tu solicitud.')
    expect(screen.getByTestId('aviso-handoff').textContent).not.toMatch(/puedo ayudarte/)   // V2-D2 · no repite el saludo de D1
    fireEvent.click(screen.getByTestId('btn-rechazar-asesor'))
    await waitFor(() => expect(f.llamadas.some((l) => l.fn === 'rechazarAsesor' && l.args[0] === 'C1')).toBe(true))
    expect(screen.queryByText(/en breve/)).toBeNull()   // nunca la promesa vieja
  })
  it('CI-2 · fuera de horario (o sin horario): sin inventar horarios ni prometer inmediatez; nombre solo si está asignada', async () => {
    const f = chatFalso({ modo: 'human_assigned', asesor_nombre: 'Ana', handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: true, asignado: true, puede_rechazar: true } })
    render(<ChatCanonico cliente={f.c} conCarrito={false} intervaloMs={60_000} />)
    expect(await screen.findByTestId('aviso-handoff')).toHaveTextContent('Ana, tu asesora, ya tiene tu solicitud.')
    expect(screen.getByTestId('chat-modo')).toHaveTextContent('Avisamos a Ana · el asistente sigue contigo')
    expect(screen.queryByText(/horario|pronto|en breve/)).toBeNull()
  })
  it('CI-2 · asignado sin nombre del servidor: copia genérica; con la sesión humana activa no hay aviso ni botón de rechazo', async () => {
    const f = chatFalso({ modo: 'human_assigned', handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: false, asignado: true, puede_rechazar: true } })
    render(<ChatCanonico cliente={f.c} conCarrito={false} intervaloMs={60_000} />)
    expect(await screen.findByTestId('aviso-handoff')).toHaveTextContent('Nuestro equipo comercial ya tiene tu solicitud.')
    expect(screen.getByTestId('chat-modo')).toHaveTextContent('Avisamos a tu asesor · el asistente sigue contigo')
    cleanup()
    const g = chatFalso({ modo: 'human_active', handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: false, asignado: true, puede_rechazar: false } })
    render(<ChatCanonico cliente={g.c} conCarrito={false} intervaloMs={60_000} />)
    await screen.findByTestId('chat-modo')
    expect(screen.queryByTestId('aviso-handoff')).toBeNull(); expect(screen.queryByTestId('btn-rechazar-asesor')).toBeNull()
    expect(screen.getByTestId('aviso-asesor-activo')).toHaveTextContent('Tu asesor está contigo')
  })
})

const item = (x: Partial<ColaItem>): ColaItem => ({ conversation_id: 'C', modo: 'human_assigned', seller_profile_id: 'S', asesoria_solicitada_at: null, last_message_at: null, es_mia: true, sin_leer: 0, dueno: 'Dra. Ruiz', ...x })
describe('Asesorías', () => {
  it('vendedor: solo lo suyo, con carrito / fuera de horario / antigüedad; ya NO hay "Tomar"', async () => {
    const f = chatFalso({}, [item({ conversation_id: 'C1', handoff_origen: 'carrito', n_items: 2, fuera_horario: true, edad_min: 90 })])
    render(<Asesorias cliente={f.c} intervaloMs={60_000} />)
    expect(await screen.findByTestId('marca-carrito')).toHaveTextContent('Carrito activo · 2 productos')
    expect(screen.getByTestId('marca-fuera-horario')).toBeInTheDocument(); expect(screen.getByText(/hace 1 h/)).toBeInTheDocument()
    expect(screen.queryByText('Tomar')).toBeNull(); expect(screen.queryByTestId('btn-asignar')).toBeNull()
  })
  it('Dirección: ve "Sin vendedor" con su motivo y va a Atención comercial para asignar', async () => {
    const onAtencion = vi.fn()
    const f = chatFalso({}, [item({ conversation_id: 'C2', modo: 'human_requested', seller_profile_id: null, es_mia: false, ruteo_motivo: 'sin_vendedor' })])
    render(<Asesorias cliente={f.c} intervaloMs={60_000} esDireccion onAtencion={onAtencion} />)
    fireEvent.click(await screen.findByTestId('btn-asignar'))
    expect(onAtencion).toHaveBeenCalled(); expect(screen.getByText('Cliente sin vendedor')).toBeInTheDocument()
  })
})

const horario: Horario = { zona: 'America/Mazatlan', configurado: false, actualizado_at: '', semana: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia: d, abierto: false, abre: null, cierra: null })), excepciones: [], estado: { configurado: false, abierto: false, zona: 'America/Mazatlan', motivo: 'sin_configurar' } }
function atencionFalsa(p: Partial<Pendientes> = {}, wa: BandejaWhatsApp = { modo: 'espejo', chats: [] }) {
  const llamadas: Array<{ fn: string; args: unknown[] }> = []
  const reg = (fn: string, data: unknown) => vi.fn(async (...args: unknown[]) => { llamadas.push({ fn, args }); return ok(data) })
  const pend: Pendientes = { resumen: { horario: horario.estado, sin_vendedor: 1, reasignacion: 0, handoffs_sin_asignar: 2, handoffs_pendientes: 0, vendedores_elegibles: 1 }, conversaciones: [], carritos_pendientes: [], ...p }
  const c = {
    pendientes: reg('pendientes', pend), resumen: reg('resumen', pend.resumen), cartera: reg('cartera', []), asignar: reg('asignar', { idempotente: false }),
    vendedores: reg('vendedores', [{ id: 'S1', nombre: 'Ana', activo: true, conversaciones: true, nuevos_clientes: true, elegible: true, elegible_nuevos: true, clientes: 0 }]),
    whatsapp: reg('whatsapp', wa),
    horario: reg('horario', horario), guardarHorario: reg('guardarHorario', { ...horario, configurado: true }), guardarExcepcion: reg('guardarExcepcion', horario), borrarExcepcion: reg('borrarExcepcion', horario),
  } as unknown as ClienteAtencion
  return { c, llamadas }
}
const pendiente = (x: Partial<Pendientes['conversaciones'][number]>): Pendientes['conversaciones'][number] => ({ conversation_id: 'C', dueno: 'doctor', profile_id: 'D1', nombre: 'Dra. Ruiz', modo: 'human_requested', seller_id: null, seller_nombre: null, ruteo_motivo: 'sin_vendedor', origen: 'carrito', fuera_horario: false, solicitado_at: null, edad_min: 5, iniciada: false, cart_id: 'K', n_items: 1, ...x })

describe('Atención comercial (Dirección)', () => {
  it('horario sin configurar visible; doctor sin vendedor → se asigna a su CARTERA; visitante → solo la conversación', async () => {
    const a = atencionFalsa({ conversaciones: [pendiente({ conversation_id: 'C1' }), pendiente({ conversation_id: 'C2', dueno: 'visitante', profile_id: null, nombre: 'Visitante', ruteo_motivo: 'visitante' })] })
    const ch = chatFalso({})
    render(<AtencionComercial cliente={a.c} chat={ch.c} />)
    expect(await screen.findByTestId('estado-horario')).toHaveTextContent('SIN CONFIGURAR')
    const filas = await screen.findAllByTestId('pendiente')
    fireEvent.change(filas[0].querySelector('select')!, { target: { value: 'S1' } })
    fireEvent.click(filas[0].querySelector('[data-testid="btn-asignar-pendiente"]')!)
    await waitFor(() => expect(a.llamadas.some((l) => l.fn === 'asignar' && l.args[0] === 'D1' && l.args[1] === 'S1')).toBe(true))
    fireEvent.change(filas[1].querySelector('select')!, { target: { value: 'S1' } })
    fireEvent.click(filas[1].querySelector('[data-testid="btn-asignar-pendiente"]')!)
    await waitFor(() => expect(ch.llamadas.some((l) => l.fn === 'asignar' && l.args[0] === 'C2' && l.args[1] === 'S1')).toBe(true))
  })
})

describe('Atención comercial · pestaña WhatsApp (169)', () => {
  const chatWa = (x: Partial<BandejaWhatsApp['chats'][number]> = {}): BandejaWhatsApp['chats'][number] => ({ wa_id: '5216671647799', nombre: 'Stryv Studio', ultimo_entrante_at: new Date().toISOString(), ventana_abierta: true, cliente: false, cliente_nombre: null, conversation_id: 'CW1', modo: 'ai_active', estado: 'abierta', vendedor: null, n_mensajes: 1, ultimo_texto: 'Prueba Renovacell', ultimo_actor: 'visitor', ultimo_at: new Date().toISOString(), hace_min: 3, sin_responder: true, ...x })
  it('espejo: lista los chats de WhatsApp (nombre, número, sin cuenta, sin responder) y abre la conversación en solo lectura', async () => {
    const a = atencionFalsa({}, { modo: 'espejo', chats: [chatWa(), chatWa({ wa_id: '5216671230002', nombre: 'Dra', cliente: true, cliente_nombre: 'Dra. Wa', conversation_id: 'CW2', sin_responder: false, ultimo_actor: 'ai', ultimo_texto: 'Sí, tenemos.' })] })
    const ch = chatFalso({ conversation_id: 'CW1', rol: 'supervisor', modo: 'ai_active', whatsapp: { wa_id: '5216671647799', modo: 'espejo', ventana_abierta: true, ventana_hasta: null, fallidos: 0 } })
    render(<AtencionComercial cliente={a.c} chat={ch.c} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'WhatsApp' }))
    expect((await screen.findByTestId('wa-modo')).textContent).toMatch(/Espejo/)
    const filas = await screen.findAllByTestId('wa-chat')
    expect(filas).toHaveLength(2)
    expect(filas[0]).toHaveTextContent('Stryv Studio'); expect(filas[0]).toHaveTextContent('+52 667 164 7799'); expect(filas[0]).toHaveTextContent('Sin cuenta'); expect(filas[0]).toHaveTextContent('Sin responder'); expect(filas[0]).toHaveTextContent('Cliente: Prueba Renovacell'); expect(filas[0]).toHaveTextContent('hace 3 min')
    expect(filas[1]).toHaveTextContent('Dra. Wa'); expect(filas[1]).toHaveTextContent('Cliente'); expect(filas[1]).not.toHaveTextContent('Sin responder'); expect(filas[1]).toHaveTextContent('Asistente: Sí, tenemos.')
    expect(a.llamadas.some((l) => l.fn === 'whatsapp')).toBe(true)
    fireEvent.click(filas[0].querySelector('[data-testid="wa-abrir"]')!)
    await waitFor(() => expect(ch.llamadas.some((l) => l.fn === 'leer' && l.args[0] === 'CW1')).toBe(true))
    expect((await screen.findByTestId('wa-espejo')).textContent).toMatch(/no se puede escribir/)
    expect((screen.getByTestId('btn-enviar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('wa-volver'))
    expect(await screen.findByTestId('wa-bandeja')).toBeTruthy()
  })
  it('activo: la pestaña lo dice y el botón es "Abrir chat"', async () => {
    const a = atencionFalsa({}, { modo: 'activo', chats: [chatWa()] })
    render(<AtencionComercial cliente={a.c} chat={chatFalso({}).c} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'WhatsApp' }))
    expect((await screen.findByTestId('wa-modo')).textContent).toBe('Activo')
    expect(screen.getByTestId('wa-abrir')).toHaveTextContent('Abrir chat')
  })
  it('sin chats: lo dice; Ventas no tiene la pestaña (la función del servidor lo exige, aquí solo no se muestra nada roto)', async () => {
    const a = atencionFalsa({}, { modo: 'espejo', chats: [] })
    render(<AtencionComercial cliente={a.c} chat={chatFalso({}).c} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'WhatsApp' }))
    expect(await screen.findByText(/Todavía no ha escrito nadie/)).toBeTruthy()
  })
})

describe('Horario de atención', () => {
  it('valida apertura < cierre antes de enviar y guarda los 7 días en el servidor', async () => {
    const a = atencionFalsa()
    render(<HorarioAtencion cliente={a.c} />)
    const dias = await screen.findAllByTestId('horario-dia')
    fireEvent.click(dias[0].querySelector('input[type="checkbox"]')!)
    const [abre, cierra] = Array.from(screen.getAllByTestId('horario-dia')[0].querySelectorAll('input[type="time"]')) as HTMLInputElement[]
    fireEvent.change(abre, { target: { value: '18:00' } }); fireEvent.change(cierra, { target: { value: '09:00' } })
    fireEvent.click(screen.getByTestId('horario-guardar'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Lunes: la apertura debe ser antes del cierre.')
    expect(a.llamadas.some((l) => l.fn === 'guardarHorario')).toBe(false)
    fireEvent.change(abre, { target: { value: '09:00' } }); fireEvent.change(cierra, { target: { value: '18:00' } })
    fireEvent.click(screen.getByTestId('horario-guardar'))
    await waitFor(() => expect(a.llamadas.some((l) => l.fn === 'guardarHorario')).toBe(true))
    const [zona, semana] = a.llamadas.find((l) => l.fn === 'guardarHorario')!.args as [string, Array<{ dia: number; abierto: boolean; abre: string | null }>]
    expect(zona).toBe('America/Mazatlan'); expect(semana).toHaveLength(7); expect(semana[0]).toMatchObject({ dia: 1, abierto: true, abre: '09:00', cierra: '18:00' }); expect(semana[1]).toMatchObject({ abierto: false, abre: null })
  })
})

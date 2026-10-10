// @vitest-environment jsdom
// CHV2-B · Experiencia de alerta comercial + Inicio por rol. Se protege:
//   A/B  el vendedor ve solo SUS solicitudes y nunca lee la cola de Dirección
//   C/D  Dirección ve lo sin vendedor/escalado; Inicio y Mi bandeja salen de la misma verdad
//   E/F/G/Q  la señal en vivo relee el servidor, un aviso viejo no revive trabajo, descartar no resuelve,
//        y otra pestaña no repite la misma alerta
//   H/I  "Atender ahora" abre la conversación exacta con el comando canónico de inicio
//   J/K/L  reasignar SOLO la solicitud vs. cambiar la cartera (acciones y textos distintos)
//   M/N  doctor / almacén / chofer no leen datos comerciales del staff
//   O    horario sin configurar se dice tal cual (sin "minutos de retraso")
//   R/S  campana con conteo y apertura profunda acotada a la navegación del rol
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

const srv = vi.hoisted(() => ({ role: 'pos' as string, capabilities: ['conversaciones'] as string[], setScreen: vi.fn(), user: { name: 'Lucía Hernández · Ventas', email: 'ventas1@renovacell.mx' } }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: srv.role, capabilities: srv.capabilities, setScreen: srv.setScreen, user: srv.user, screen: 'inicio' }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: [] }), useOrders: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: {} }), usePaymentClaims: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useLots', () => ({ useLots: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useDoctors', () => ({ useDoctors: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useProspects', () => ({ useProspects: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useStockReturns', () => ({ useStockReturns: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useCompras', () => ({ useCompras: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useCustody', () => ({ useCustodies: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useRevisionFiscal', () => ({ useRevisionFiscal: () => ({ avance: { total: 0, validados: 0 }, loading: false }) }))
vi.mock('../../data/hooks/useComunicaciones', () => ({ useComunicaciones: () => ({ cuentas: { porEnviar: 0, enviados: 0, conProblema: 0 }, loading: false }) }))
vi.mock('../../data/hooks/useSaludSistema', () => ({ useSaludSistema: () => ({ estado: 'healthy' }) }))

import { ClienteChat, type ColaItem } from '../../data/ops/chat'
import { ClienteAtencion, type Pendientes, type PendienteRuteo } from '../../data/ops/atencion'
import { textoEspera, TEXTO_HORARIO_PENDIENTE, type Atencion, type EstadoAtencion } from '../../data/ops/atencionComercial'
import { configurarClientesAtencion } from '../../data/store/atencionStore'
import { _simularLlegada, type Notif } from '../../data/store/notificationsStore'
import { intentoActual, consumirIntento, pedirIntento } from '../../data/store/navIntentStore'
import { marcar } from '../../lib/avisosPestanas'
import { RoleHome } from './RoleHome'
import { configurarClientesInicioDoctor } from './HomeDoctor'
import { Bandeja } from '../Bandeja'
import { AlertaComercial } from '../../app/AlertaComercial'
import { Asesorias } from '../chat/Asesorias'
import { AtencionComercial } from '../admin/AtencionComercial'

const at = (estado: EstadoAtencion, x: Partial<Atencion> = {}): Atencion => ({
  estado, modo: estado === 'activo' ? 'human_active' : estado === 'solicitado_sin_vendedor' ? 'human_requested' : 'human_assigned', handoff_estado: 'solicitado', handler_id: 'S1', ruteo_motivo: null,
  solicitado_at: null, handler_asignado_at: null, iniciado_at: null, terminado_at: null, espera_total_min: 9, espera_total_habil_min: null, espera_handler_min: 9, espera_handler_habil_min: null,
  reloj_sla_min: null, horario_configurado: false, en_horario: null, pausa_fuera_horario: true, umbral_aviso_min: 3, umbral_escalamiento_min: 7, ia_activa: estado !== 'activo', ...x,
})
const item = (x: Partial<ColaItem>): ColaItem => ({ conversation_id: 'C1', modo: 'human_assigned', seller_profile_id: 'S1', asesoria_solicitada_at: null, last_message_at: null, es_mia: true, sin_leer: 0, dueno: 'Dr. David Espinoza', n_items: 1, edad_min: 9, atencion: at('horario_sin_configurar'), ...x })
const pend = (x: Partial<PendienteRuteo>): PendienteRuteo => ({ conversation_id: 'C1', dueno: 'doctor', profile_id: 'D1', nombre: 'Dr. David Espinoza', modo: 'human_assigned', seller_id: 'S1', seller_nombre: 'Lucía', ruteo_motivo: null, origen: 'carrito', fuera_horario: false, solicitado_at: null, edad_min: 12, iniciada: false, cart_id: 'K', n_items: 1, ...x })
const horario = { configurado: true, abierto: true, zona: 'America/Mazatlan', motivo: 'abierto' }

type Llamada = { action?: string; fn?: string; body?: Record<string, unknown>; args?: Record<string, unknown> }
function chatFalso(cola: () => ColaItem[]) {
  const llamadas: Llamada[] = []
  const c = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string; llamadas.push({ action: a, body })
    if (a === 'cola') return { data: { cola: cola() }, error: null }
    if (a === 'iniciar') return { data: { modo: 'human_active' }, error: null }
    if (a === 'abrir') return { data: { conversation_id: 'CD', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null }
    if (a === 'leer') return { data: { conversation_id: body.conversation_id, estado: 'abierta', modo: 'human_active', rol: 'asesor', asesor_soy_yo: true, ultimo_seq: 0, mensajes: [] }, error: null }
    return { data: { ok: true }, error: null }
  }, () => null)
  return { c, llamadas }
}
function atencionFalsa(p: () => Pendientes) {
  const llamadas: Llamada[] = []
  const vendedores = [{ id: 'S1', nombre: 'Lucía', activo: true, conversaciones: true, nuevos_clientes: true, elegible: true, elegible_nuevos: true, clientes: 1 }, { id: 'S2', nombre: 'Ana', activo: true, conversaciones: true, nuevos_clientes: true, elegible: true, elegible_nuevos: true, clientes: 0 }]
  const c = new ClienteAtencion(async (fn, args) => {
    llamadas.push({ fn, args })
    if (fn === 'cc_ruteo_pendientes') return { data: p(), error: null }
    if (fn === 'cc_vendedores') return { data: vendedores, error: null }
    if (fn === 'cc_cartera_listar') return { data: [{ profile_id: 'D1', nombre: 'Dr. David Espinoza', verificado: true, activo: true, vendedor_id: 'S1', vendedor_nombre: 'Lucía', vendedor_elegible: true, requiere_reasignacion: false, asignado_at: null, vendedor_historico: null }], error: null }
    if (fn === 'cc_solicitud_reasignar') return { data: { cartera_vendedor: 'S1' }, error: null }
    if (fn === 'cc_cartera_asignar') return { data: { idempotente: false }, error: null }
    return { data: {}, error: null }
  })
  return { c, llamadas }
}
const PEND: Pendientes = {
  resumen: { horario, sin_vendedor: 1, reasignacion: 0, handoffs_sin_asignar: 1, handoffs_pendientes: 0, vendedores_elegibles: 2 },
  conversaciones: [
    pend({ conversation_id: 'CE', atencion: at('escalado', { horario_configurado: true, en_horario: true, reloj_sla_min: 8 }) }),
    pend({ conversation_id: 'CS', profile_id: 'D3', nombre: 'Dra. Carmen López', modo: 'human_requested', seller_id: null, seller_nombre: null, ruteo_motivo: 'sin_vendedor', atencion: at('solicitado_sin_vendedor') }),
    pend({ conversation_id: 'CW', profile_id: 'D2', nombre: 'Dra. Ana Ruiz', atencion: at('asignado_esperando', { horario_configurado: true, en_horario: true, reloj_sla_min: 1 }) }),
  ],
  carritos_pendientes: [],
}
const notif = (x: Partial<Notif>): Notif => ({ id: 'n-' + Math.random().toString(36).slice(2), text: 'Solicitud de asesor', at: '2026-10-06T22:55:00Z', read: false, kind: 'handoff_asignado', conversationId: 'C1', screen: 'asesorias', ...x })
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })

let colaVendedor: ColaItem[] = []
let ch = chatFalso(() => colaVendedor)
let ac = atencionFalsa(() => PEND)
beforeEach(() => {
  cleanup()
  try { localStorage.clear() } catch { /* sin almacenamiento */ }
  const i = intentoActual(); if (i) consumirIntento(i.id)
  Object.assign(srv, { role: 'pos', capabilities: ['conversaciones'], setScreen: vi.fn() })
  colaVendedor = [item({}), item({ conversation_id: 'CX', es_mia: false, dueno: 'Cliente de otro vendedor' })]
  ch = chatFalso(() => colaVendedor); ac = atencionFalsa(() => PEND)
  configurarClientesAtencion({ chat: ch.c, atencion: ac.c })
})

describe('Inicio de Ventas', () => {
  it('A/B · solo SUS solicitudes; nunca consulta la cola de Dirección', async () => {
    render(<RoleHome />); await flush()
    const tarjetas = await screen.findAllByTestId('solicitud')
    expect(tarjetas).toHaveLength(1)
    expect(tarjetas[0]).toHaveTextContent('Dr. David Espinoza solicita atención')
    expect(screen.queryByText(/Cliente de otro vendedor/)).toBeNull()
    expect(ac.llamadas.some((l) => l.fn === 'cc_ruteo_pendientes')).toBe(false)
  })
  it('O · sin horario: "Horario comercial pendiente de configurar", nunca minutos de SLA', async () => {
    render(<RoleHome />); await flush()
    const t = await screen.findByTestId('solicitud')
    expect(t).toHaveTextContent(TEXTO_HORARIO_PENDIENTE)
    expect(t).not.toHaveTextContent(/hábiles/)
    expect(t).toHaveTextContent('IA atendiendo mientras espera asesor')
  })
  it('vacío útil y asesoría activa sin "IA activa"', async () => {
    colaVendedor = [item({ conversation_id: 'CA', modo: 'human_active', iniciada: true, sin_leer: 2, atencion: at('activo') })]
    render(<RoleHome />); await flush()
    expect(await screen.findByTestId('vacio-solicitudes')).toHaveTextContent('Sin solicitudes de asesor')
    const a = screen.getByTestId('asesoria-activa')
    expect(a).toHaveTextContent('2 mensajes sin leer'); expect(a).not.toHaveTextContent(/IA atendiendo/)
  })
  it('H · ATENDER AHORA pide abrir la conversación EXACTA con inicio canónico', async () => {
    render(<RoleHome />); await flush()
    fireEvent.click(await screen.findByTestId('btn-atender'))
    expect(srv.setScreen).toHaveBeenCalledWith('asesorias')
    expect(intentoActual()).toMatchObject({ destino: 'asesorias', conversationId: 'C1', iniciar: true })
  })
})

describe('Conversaciones · apertura profunda', () => {
  it('I · usa el comando canónico "iniciar" sobre esa conversación; no abre/crea otra ni pide asesor', async () => {
    pedirIntento({ destino: 'asesorias', conversationId: 'C1', iniciar: true, origen: 'inicio' })
    render(<Asesorias cliente={ch.c} intervaloMs={600_000} />)
    await waitFor(() => expect(ch.llamadas.some((l) => l.action === 'iniciar' && l.body?.conversation_id === 'C1')).toBe(true))
    await waitFor(() => expect(ch.llamadas.some((l) => l.action === 'leer' && l.body?.conversation_id === 'C1')).toBe(true))
    expect(ch.llamadas.some((l) => l.action === 'abrir' || l.action === 'solicitar_asesor' || l.action === 'asignar')).toBe(false)
    expect(intentoActual()).toBeNull()
  })
  it('S · un id que no está en la cola autorizada no se abre ni revela nada', async () => {
    pedirIntento({ destino: 'asesorias', conversationId: 'AJENA', iniciar: true, origen: 'campana' })
    render(<Asesorias cliente={ch.c} intervaloMs={600_000} />)
    expect(await screen.findByTestId('aviso-apertura')).toHaveTextContent('ya no está en tu cola')
    expect(ch.llamadas.some((l) => l.action === 'iniciar' || l.action === 'leer')).toBe(false)
  })
})

describe('Inicio de Dirección', () => {
  beforeEach(() => { srv.role = 'admin'; srv.capabilities = [] })
  it('C · sin vendedor y escaladas requieren intervención; lo asignado en tiempo no', async () => {
    render(<RoleHome />); await flush()
    const t = await screen.findAllByTestId('intervencion')
    expect(t.map((x) => x.textContent)).toEqual([expect.stringContaining('David Espinoza sigue esperando asesor'), expect.stringContaining('Carmen López solicita asesor')])
    expect(screen.queryByText(/Ana Ruiz/)).toBeNull()
  })
  it('D · Mi bandeja cuenta lo mismo (sin vendedor + escaladas) desde la misma lectura', async () => {
    render(<Bandeja />); await flush()
    const fila = (await screen.findByText('Atención comercial pendiente')).closest('button')!
    expect(fila).toHaveTextContent('1 conversación(es) sin vendedor'); expect(fila).toHaveTextContent('1 solicitud(es) escalada(s) por espera')
    expect(fila.querySelector('.pill')?.textContent).toBe('2')
  })
})

describe('Alerta comercial en vivo', () => {
  it('E · la señal relee el servidor y muestra la solicitud accionable', async () => {
    render(<AlertaComercial />); await flush()
    const antes = ch.llamadas.filter((l) => l.action === 'cola').length
    act(() => _simularLlegada(notif({ eventKey: 'asignacion:C1:S1:1' })))
    await flush()
    expect(ch.llamadas.filter((l) => l.action === 'cola').length).toBeGreaterThan(antes)
    const a = await screen.findByTestId('alerta-comercial')
    expect(a).toHaveTextContent('Dr. David Espinoza solicita atención'); expect(a).toHaveTextContent('IA atendiendo mientras espera asesor')
    expect(a.getAttribute('role')).toBe('alert')
  })
  it('F · un aviso viejo (la asesoría ya inició) no revive trabajo', async () => {
    colaVendedor = [item({ modo: 'human_active', atencion: at('activo') })]
    render(<AlertaComercial />); await flush()
    act(() => _simularLlegada(notif({ eventKey: 'asignacion:C1:S1:2' })))
    await flush()
    expect(screen.queryByTestId('alerta-comercial')).toBeNull()
  })
  it('G · descartar quita la alerta pero NO resuelve: sigue en Inicio', async () => {
    render(<><AlertaComercial /><RoleHome /></>); await flush()
    act(() => _simularLlegada(notif({ eventKey: 'asignacion:C1:S1:3' })))
    fireEvent.click(await screen.findByTestId('alerta-descartar'))
    expect(screen.queryByTestId('alerta-comercial')).toBeNull()
    expect(screen.getAllByTestId('solicitud')).toHaveLength(1)
  })
  it('Q · si otra pestaña ya presentó la señal, esta no la repite; descartar en otra la quita aquí', async () => {
    marcar('asignacion:C1:S1:4', 'visto')
    render(<AlertaComercial />); await flush()
    act(() => _simularLlegada(notif({ eventKey: 'asignacion:C1:S1:4' })))
    await flush()
    expect(screen.queryByTestId('alerta-comercial')).toBeNull()
    act(() => _simularLlegada(notif({ eventKey: 'asignacion:C1:S1:5' })))
    expect(await screen.findByTestId('alerta-comercial')).toBeTruthy()
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'rc-aviso:asignacion:C1:S1:5', newValue: JSON.stringify({ e: 'descartado', t: Date.now() }) })) })
    await waitFor(() => expect(screen.queryByTestId('alerta-comercial')).toBeNull())
  })
  it('Dirección: escalada → Abrir / Reasignar llevan a la solicitud exacta en Atención comercial', async () => {
    srv.role = 'admin'; srv.capabilities = []
    render(<AlertaComercial />); await flush()
    act(() => _simularLlegada(notif({ kind: 'handoff_escalado', conversationId: 'CE', eventKey: 'escalacion:CE:1', screen: 'av_atencion' })))
    fireEvent.click(await screen.findByTestId('alerta-reasignar'))
    expect(srv.setScreen).toHaveBeenCalledWith('av_atencion')
    expect(intentoActual()).toMatchObject({ destino: 'av_atencion', conversationId: 'CE', reasignar: true })
  })
})

describe('Atención comercial · solicitud vs. cartera', () => {
  beforeEach(() => { srv.role = 'admin'; srv.capabilities = [] })
  it('J/K · "Reasignar esta solicitud" usa cc_solicitud_reasignar con motivo y dice que la cartera NO cambia', async () => {
    render(<AtencionComercial cliente={ac.c} chat={ch.c} />)
    const filas = await screen.findAllByTestId('pendiente')
    expect(filas[0]).toHaveTextContent('Vendedor de cartera'); expect(filas[0]).toHaveTextContent('Atiende esta solicitud')
    fireEvent.click(filas[0].querySelector('[data-testid="btn-reasignar-solicitud"]')!)
    const modal = await screen.findByTestId('modal-reasignar-solicitud')
    expect(screen.getByTestId('explica-solicitud')).toHaveTextContent('La cartera del cliente no cambia')
    fireEvent.change(screen.getByTestId('sel-handler'), { target: { value: 'S2' } })
    expect(screen.getByTestId('btn-confirmar-reasignacion')).toBeDisabled()   // sin motivo no se puede
    fireEvent.change(screen.getByTestId('motivo-handler'), { target: { value: 'Lucía en junta' } })
    fireEvent.click(screen.getByTestId('btn-confirmar-reasignacion'))
    await waitFor(() => expect(ac.llamadas.some((l) => l.fn === 'cc_solicitud_reasignar' && l.args?.p_conv === 'CE' && l.args?.p_vendedor === 'S2' && l.args?.p_motivo === 'Lucía en junta')).toBe(true))
    expect(ac.llamadas.some((l) => l.fn === 'cc_cartera_asignar')).toBe(false)
    expect(await screen.findByTestId('msg-atencion')).toHaveTextContent('La cartera no cambió: sigue con Lucía')
    expect(modal.isConnected).toBe(false)
  })
  it('L · "Cambiar vendedor de cartera" es aparte, permanente y usa cc_cartera_asignar', async () => {
    render(<AtencionComercial cliente={ac.c} chat={ch.c} />)
    const filas = await screen.findAllByTestId('pendiente')
    fireEvent.click(filas[0].querySelector('[data-testid="btn-cambiar-cartera"]')!)
    await screen.findByTestId('modal-cambiar-cartera')
    expect(screen.getByTestId('explica-cartera-permanente')).toHaveTextContent('Cambio permanente')
    fireEvent.change(screen.getByLabelText('Nuevo vendedor de cartera'), { target: { value: 'S2' } })
    fireEvent.change(screen.getByTestId('motivo-cartera'), { target: { value: 'Cambio de zona' } })
    fireEvent.click(screen.getByTestId('btn-confirmar-cartera'))
    await waitFor(() => expect(ac.llamadas.some((l) => l.fn === 'cc_cartera_asignar' && l.args?.p_cliente === 'D1' && l.args?.p_vendedor === 'S2')).toBe(true))
    expect(ac.llamadas.some((l) => l.fn === 'cc_solicitud_reasignar')).toBe(false)
  })
  it('apertura profunda resalta la solicitud; una ya resuelta se informa', async () => {
    pedirIntento({ destino: 'av_atencion', conversationId: 'YA_NO', origen: 'campana' })
    render(<AtencionComercial cliente={ac.c} chat={ch.c} />)
    expect(await screen.findByTestId('solicitud-no-disponible')).toBeTruthy()
  })
})

describe('Roles sin datos comerciales', () => {
  it('M · el doctor ve su Inicio y jamás pide colas del staff', async () => {
    srv.role = 'doctor'; srv.capabilities = []
    const doc = chatFalso(() => [])
    configurarClientesInicioDoctor({ chat: doc.c })
    render(<RoleHome />); await flush()
    expect(await screen.findByTestId('home-doctor')).toBeTruthy()
    expect(doc.llamadas.some((l) => l.action === 'cola')).toBe(false)
    expect(ch.llamadas.some((l) => l.action === 'cola')).toBe(false)
    expect(ac.llamadas.length).toBe(0)
  })
  it('N · almacén y chofer: sin lecturas comerciales y sin alerta', async () => {
    for (const r of ['warehouse', 'driver']) {
      cleanup(); srv.role = r; srv.capabilities = []
      render(<><RoleHome /><AlertaComercial /></>); await flush()
      act(() => _simularLlegada(notif({ eventKey: `x:${r}` })))
      await flush()
      expect(screen.queryByTestId('alertas-comerciales')).toBeNull()
    }
    expect(ch.llamadas.some((l) => l.action === 'cola')).toBe(false)
    expect(ac.llamadas.length).toBe(0)
  })
  it('vendedor SIN "Atender conversaciones": su Inicio no consulta la cola', async () => {
    srv.capabilities = []
    render(<RoleHome />); await flush()
    expect(await screen.findByTestId('home-vendedor')).toBeTruthy()
    expect(ch.llamadas.some((l) => l.action === 'cola')).toBe(false)
  })
})

describe('CHV2-B.1 · Inicio no es un segundo menú', () => {
  it('doctor: sin bloque de accesos ni botón de chat duplicado; la atención es una línea informativa', async () => {
    srv.role = 'doctor'; srv.capabilities = []; srv.user = { name: 'david espinoza', email: 'd@x.mx' }
    const doc = new ClienteChat(async (_fn, { body }) => {
      const a = body.action as string
      if (a === 'abrir') return { data: { conversation_id: 'CD', estado: 'abierta', modo: 'human_active', nuevo: false }, error: null }
      if (a === 'leer') return { data: { conversation_id: 'CD', estado: 'abierta', modo: 'human_active', ultimo_seq: 8, asesor_nombre: 'Lucía', mensajes: [], cart_id: null }, error: null }
      return { data: { ok: true }, error: null }
    }, () => null)
    configurarClientesInicioDoctor({ chat: doc })
    render(<RoleHome />); await flush()
    expect(screen.getByText(/^(Buenos días|Buenas tardes|Buenas noches), David$/)).toBeTruthy()   // recepción: saludo según la hora del negocio
    expect(await screen.findByTestId('doctor-atencion')).toHaveTextContent('Lucía · Asesora · En conversación')
    expect(screen.queryByText('Abrir conversación')).toBeNull()
    expect(screen.queryByText('Accesos')).toBeNull()
    for (const k of ['catalogo', 'chat_cc', 'pedidosdr', 'hist']) expect(screen.queryByTestId(`acceso-${k}`)).toBeNull()
    expect(screen.queryByTestId('atajos-movil')).toBeNull()
    srv.user = { name: 'Lucía Hernández · Ventas', email: 'ventas1@renovacell.mx' }
  })
  it('staff: sin "Accesos" de escritorio; a lo sumo 3 atajos (solo móvil por CSS)', async () => {
    render(<RoleHome />); await flush()
    expect(screen.queryByText('Accesos')).toBeNull()
    const atajos = screen.getByTestId('atajos-movil')
    expect(atajos.className).toContain('rh-quick--movil')
    expect(atajos.querySelectorAll('button').length).toBeLessThanOrEqual(3)
  })
  it('cuenta de servicio "almacen": saludo neutral, sin nombrar a la cuenta como si fuera persona', async () => {
    srv.role = 'warehouse'; srv.capabilities = []; srv.user = { name: 'almacen', email: 'almacen@renovacell.mx' }
    render(<RoleHome />); await flush()
    expect(screen.getByTestId('rh-bienvenida').querySelector('h2')!.textContent).toMatch(/^(Buenos días|Buenas tardes|Buenas noches)$/)
    expect(screen.queryByText(/, almacen/i)).toBeNull()
    srv.user = { name: 'Lucía Hernández · Ventas', email: 'ventas1@renovacell.mx' }
  })
  it('vendedor: el nombre del cliente se presenta con mayúsculas ("david espinoza" → "David Espinoza")', async () => {
    colaVendedor = [item({ conversation_id: 'CA', dueno: 'david espinoza', modo: 'human_active', iniciada: true, atencion: at('activo') })]
    render(<RoleHome />); await flush()
    const a = await screen.findByTestId('asesoria-activa')
    expect(a).toHaveTextContent('David Espinoza'); expect(a).toHaveTextContent('Sin mensajes nuevos')
  })
})

describe('textoEspera (servidor, nunca reloj del navegador)', () => {
  it('configurado: minutos hábiles del servidor; cerrado: pausa; sin horario: pendiente', () => {
    expect(textoEspera(at('aviso', { horario_configurado: true, en_horario: true, reloj_sla_min: 4 }))).toBe('4 min hábiles esperando')
    expect(textoEspera(at('fuera_de_horario', { horario_configurado: true, en_horario: false, reloj_sla_min: 4 }))).toMatch(/Fuera de horario/)
    expect(textoEspera(at('horario_sin_configurar'))).toBe(TEXTO_HORARIO_PENDIENTE)
    expect(textoEspera(at('activo'))).toBeNull()
  })
})

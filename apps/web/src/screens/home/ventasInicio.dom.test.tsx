// @vitest-environment jsdom
// VENDER Y COBRAR DESDE INICIO (27 nov 2026, «sistema sencillo por rol»). Misma preparación que chv2b.dom.test.tsx.
// (encabezado original) CHV2-B · Experiencia de alerta comercial + Inicio por rol. Se protege:
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
vi.mock('../../data/ops/cancelacionSolicitud', () => ({ useSolicitudesCancelacion: () => [] }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: srv.role, capabilities: srv.capabilities, setScreen: srv.setScreen, user: srv.user, screen: 'inicio' }), useRoleOpcional: () => null }))
const ped = vi.hoisted(() => ({ lista: [] as unknown[] }))
vi.mock('../../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: ped.lista }), useOrders: () => ({ data: [] }) }))
vi.mock('../pos/SelectorCliente', () => ({ SelectorClienteVentas: ({ onPick }: { onPick: (c: unknown) => void }) => <button type="button" data-testid="selector-cliente" onClick={() => onPick({ id: 'c1', name: 'Dra. Ana Morales', phone: null, mascara: null })}>elegir cliente</button> }))
vi.mock('../sales/NuevoPedido', () => ({ NuevoPedido: ({ customer }: { customer: { name: string } }) => <div data-testid="nuevo-pedido">Pedido para {customer.name}</div> }))
vi.mock('../cobros/LinksPago', () => ({ CobrarPedido: ({ pedido }: { pedido: { external_ref: string } }) => <div data-testid="cobrar-pedido">Confirmar pago de {pedido.external_ref}</div> }))
vi.mock('../../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: {} }), usePaymentClaims: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useShipments', () => ({ useShipments: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useLots', () => ({ useLots: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useDoctors', () => ({ useDoctors: () => ({ data: [] }) }))
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


describe('Inicio de Ventas · vender y cobrar sin pasar por el menú', () => {
  const pedido = (id: string, folio: string, nombre: string, extra: Record<string, unknown> = {}) => ({ id, external_ref: folio, status: 'pending_payment', payment_status: 'pending', total: 9000, created_at: '2026-11-25T18:00:00Z', items: [], shipping_meta: { customer: { name: nombre } }, ...extra })
  beforeEach(() => { ped.lista = [] })

  it('«Levantar pedido» está en Inicio: elige al cliente y abre su pedido', async () => {
    render(<RoleHome />)
    fireEvent.click(await screen.findByTestId('inicio-levantar-pedido'))
    fireEvent.click(screen.getByTestId('selector-cliente'))
    expect(screen.getByTestId('nuevo-pedido')).toHaveTextContent('Pedido para Dra. Ana Morales')
  })

  it('los pedidos que esperan pago salen en Inicio con «Confirmar pago»', async () => {
    ped.lista = [pedido('o1', 'S201', 'RENATO VEGA OSUNA'), pedido('o2', 'S202', 'Dra. Luna', { payment_status: 'paid', status: 'paid' }), pedido('o3', 'S203', 'Cancelado', { status: 'cancelled' })]
    render(<RoleHome />)
    const filas = await screen.findAllByTestId('inicio-por-confirmar')
    expect(filas).toHaveLength(1)
    expect(filas[0]).toHaveTextContent('Renato Vega Osuna')
    expect(filas[0]).toHaveTextContent('S201')
    fireEvent.click(screen.getByTestId('inicio-confirmar-pago'))
    expect(screen.getByTestId('cobrar-pedido')).toHaveTextContent('Confirmar pago de S201')
  })

  it('«Tus pedidos en curso»: los que ya van caminando, con su paso y el avance; los que esperan pago no se repiten', async () => {
    ped.lista = [
      pedido('o1', 'S201', 'RENATO VEGA OSUNA'),                                                           // espera pago → va arriba, no aquí
      pedido('o2', 'S202', 'DRA. LUNA PEREZ', { payment_status: 'paid', status: 'paid', created_at: '2026-11-26T18:00:00Z' }),
      pedido('o3', 'S203', 'Dr. Ruiz', { payment_status: 'paid', status: 'shipped', created_at: '2026-11-25T18:00:00Z' }),
      pedido('o4', 'S204', 'Entregado', { payment_status: 'paid', status: 'delivered' }),
      pedido('o5', 'S205', 'Cancelado', { status: 'cancelled' }),
    ]
    render(<RoleHome />)
    const filas = await screen.findAllByTestId('inicio-en-curso')
    expect(filas.map((f) => f.textContent)).toEqual([expect.stringContaining('S202'), expect.stringContaining('S203')])   // el más reciente primero
    expect(filas[0]).toHaveTextContent('Dra. Luna Perez'); expect(filas[0]).toHaveTextContent('En almacén')
    expect(filas[0].querySelectorAll('.rh-avance i.on')).toHaveLength(2)      // Pedido + En almacén
    expect(filas[1]).toHaveTextContent('En camino'); expect(filas[1].querySelectorAll('.rh-avance i.on')).toHaveLength(3)
    expect(filas[1].querySelectorAll('.rh-avance i')).toHaveLength(4)         // siempre los mismos cuatro pasos
    fireEvent.click(filas[0])
    expect(srv.setScreen).toHaveBeenCalled()                                  // abre Mis ventas
  })

  it('sin pedidos en curso, esa sección no ocupa lugar', async () => {
    ped.lista = [pedido('o1', 'S201', 'RENATO VEGA OSUNA'), pedido('o4', 'S204', 'Entregado', { payment_status: 'paid', status: 'delivered' })]
    render(<RoleHome />)
    await screen.findByTestId('home-vendedor')
    expect(screen.queryByTestId('inicio-en-curso')).toBeNull()
  })

  it('sin pedidos esperando pago, esa sección no ocupa lugar', async () => {
    render(<RoleHome />)
    await screen.findByTestId('home-vendedor')
    expect(screen.queryByTestId('inicio-por-confirmar')).toBeNull()
  })

  it('con más de cuatro, muestra cuatro y ofrece ver todos en «Cobrar pedidos»', async () => {
    ped.lista = [1, 2, 3, 4, 5, 6].map((n) => pedido('o' + n, 'S20' + n, 'Cliente ' + n))
    render(<RoleHome />)
    expect(await screen.findAllByTestId('inicio-por-confirmar')).toHaveLength(4)
    fireEvent.click(screen.getByText('Ver los 6'))
    expect(srv.setScreen).toHaveBeenCalledWith('links_pago')
  })
})

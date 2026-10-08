// @vitest-environment jsdom
// PAY-EXP-01A-3 · Pantalla "Revisión económica": estados (cargando, vacío, error ≠ vacío, no autorizado), UNA tarjeta
// por pedido con todas sus incidencias, montos tal cual del servidor, advertencia EXPLÍCITA (releída) antes de
// verificar una declaración de un pedido cancelado, rechazo con motivo, y reembolsos por el flujo de Ventas.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react'

const srv = vi.hoisted(() => ({ role: 'admin', setScreen: (() => {}) as (s: string) => void }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: srv.role, setScreen: (s: string) => srv.setScreen(s) }) }))
vi.mock('../../data/store/ordersStore', () => ({ revisarDeclaracion: vi.fn() }))

import { RevisionEconomica } from './RevisionEconomica'
import { ClienteRevisionEconomica, type CasoRevision, type RevisionEconomica as Rev } from '../../data/ops/revisionEconomica'
import { intentoVentasActual } from '../../data/store/ventasIntentStore'

const esperar = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
const caso = (o: Partial<CasoRevision> = {}): CasoRevision => ({
  order_id: 'O-1', folio: 'S100009', estado_pedido: 'cancelled', estado_caso: 'abierto',
  incidencia_principal: 'declaracion_abierta_en_cancelado', incidencias: ['declaracion_abierta_en_cancelado'],
  cliente: { customer_id: 'C', doctor_id: 'D', nombre: 'Dra. Prueba' },
  montos: { total: 200, cobrado_neto: 0, reembolso_pendiente: 0, sin_reembolso_autorizado: 0, saldo: 200, estado_pago: 'pending' },
  cancelacion: { fecha: '2026-10-08T10:00:00Z', motivo: 'desistió', money_signal: 'pago_reportado_en_revision', refund_review: 'pendiente_revision', actor_rol: 'admin' },
  declaraciones: [{ claim_id: 'CL-1', estado: 'reportado', metodo: 'transferencia', monto_declarado: 200, referencia: 'REF', comprobante: null, declarada_at: '2026-10-08T09:00:00Z', resuelta_at: null, motivo_rechazo: null, entry_id: null }],
  asientos: [], reembolsos: [], evidencia_resolucion: null, fecha_relevante: '2026-10-08T10:00:00Z', ...o,
})
const rev = (casos: CasoRevision[]): Rev => ({ generado_at: 'T', casos, resumen: { abiertos: casos.length, resueltos: 0, por_incidencia: {}, nota: '', stripe_anomalias: 'no_disponible' } })
function falso(respuestas: Array<{ data: unknown; error: { message: string } | null } | Error>) {
  const llamadas: unknown[] = []
  const c = new ClienteRevisionEconomica(async (_fn, args) => {
    llamadas.push(args)
    const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)]
    if (r instanceof Error) throw r
    return r
  })
  return { c, llamadas }
}

beforeEach(() => { cleanup(); srv.role = 'admin'; srv.setScreen = vi.fn() })

describe('PAY-EXP-01A-3 · estados', () => {
  it('cargando → casos (consulta revision_economica(false))', async () => {
    const f = falso([{ data: rev([caso()]), error: null }])
    render(<RevisionEconomica cliente={f.c} />)
    expect(screen.getByTestId('revision-cargando')).toBeInTheDocument()
    await esperar()
    expect(screen.getAllByTestId('revision-caso')).toHaveLength(1)
    expect(f.llamadas[0]).toEqual({ p_incluir_resueltos: false })
    expect(screen.getByTestId('revision-contador')).toHaveTextContent('1 caso(s) abierto(s)')
    expect(screen.getByTestId('revision-nota-stripe')).toBeInTheDocument()
  })
  it('sin casos → "Sin casos abiertos"', async () => {
    render(<RevisionEconomica cliente={falso([{ data: rev([]), error: null }]).c} />); await esperar()
    expect(screen.getByTestId('revision-vacia')).toBeInTheDocument()
  })
  it('error de lectura → error con reintento (NUNCA "sin casos")', async () => {
    const f = falso([new Error('red'), { data: rev([caso()]), error: null }])
    render(<RevisionEconomica cliente={f.c} />); await esperar()
    expect(screen.getByTestId('revision-error')).toBeInTheDocument()
    expect(screen.queryByTestId('revision-vacia')).toBeNull()
    fireEvent.click(screen.getByText('Reintentar')); await esperar()
    expect(screen.getAllByTestId('revision-caso')).toHaveLength(1)
  })
  it('el servidor niega (NO_AUTORIZADO) → acceso no autorizado', async () => {
    render(<RevisionEconomica cliente={falso([{ data: null, error: { message: 'NO_AUTORIZADO: solo Dirección' } }]).c} />); await esperar()
    expect(screen.getByTestId('revision-no-autorizado')).toHaveTextContent('Solo Dirección y Facturación')
  })
  it.each(['pos', 'doctor', 'warehouse'])('rol %s: ni siquiera consulta (y el servidor también lo negaría)', async (rol) => {
    srv.role = rol
    const f = falso([{ data: rev([caso()]), error: null }])
    render(<RevisionEconomica cliente={f.c} />); await esperar()
    expect(screen.getByTestId('revision-no-autorizado')).toBeInTheDocument()
    expect(f.llamadas).toHaveLength(0)
  })
})

describe('PAY-EXP-01A-3 · casos', () => {
  it('UNA tarjeta por pedido con todas sus incidencias; montos tal cual del servidor (sin recalcular)', async () => {
    const c = caso({ incidencia_principal: 'dinero_sin_reembolso_autorizado', incidencias: ['dinero_sin_reembolso_autorizado', 'reembolso_autorizado_pendiente'],
      montos: { total: 200, cobrado_neto: 777, reembolso_pendiente: 120, sin_reembolso_autorizado: 657, saldo: -577, estado_pago: 'paid' }, declaraciones: [] })
    render(<RevisionEconomica cliente={falso([{ data: rev([c]), error: null }]).c} />); await esperar()
    expect(screen.getAllByTestId('revision-caso')).toHaveLength(1)
    expect(screen.getByTestId('revision-principal')).toHaveTextContent('Dinero recibido sin reembolso autorizado')
    expect(screen.getByTestId('revision-incidencias')).toHaveTextContent('Reembolso autorizado pendiente de pago')
    const m = screen.getByTestId('revision-montos')
    expect(m).toHaveTextContent('777'); expect(m).toHaveTextContent('657'); expect(m).toHaveTextContent('120')
    fireEvent.click(screen.getByTestId('revision-detalle-toggle'))
    expect(screen.getByTestId('revision-evidencia')).toHaveTextContent('Sin declaraciones.')
  })
  it('reembolsos: "Abrir pedido en Ventas" deja la intención y navega (flujo canónico de reembolsos)', async () => {
    const c = caso({ incidencia_principal: 'reembolso_autorizado_pendiente', incidencias: ['reembolso_autorizado_pendiente'], declaraciones: [] })
    render(<RevisionEconomica cliente={falso([{ data: rev([c]), error: null }]).c} />); await esperar()
    expect(screen.queryByTestId('revision-verificar')).toBeNull()
    fireEvent.click(screen.getByTestId('revision-ir-ventas'))
    expect(intentoVentasActual()).toMatchObject({ orderId: 'O-1', folio: 'S100009' })
    expect(srv.setScreen).toHaveBeenCalledWith('av_ventas')
  })
  it('cancelación sin evidencia: sin acciones económicas, solo orientación', async () => {
    const c = caso({ incidencia_principal: 'cancelacion_sin_evidencia', incidencias: ['cancelacion_sin_evidencia'], declaraciones: [] })
    render(<RevisionEconomica cliente={falso([{ data: rev([c]), error: null }]).c} />); await esperar()
    expect(screen.queryByTestId('revision-verificar')).toBeNull(); expect(screen.queryByTestId('revision-ir-ventas')).toBeNull()
    expect(screen.getByText(/No hay acción automática/)).toBeInTheDocument()
  })
})

describe('PAY-EXP-01A-3 · verificar / rechazar (revisar_pago canónico)', () => {
  it('verificar en pedido CANCELADO: relee, advierte explícitamente y solo verifica tras confirmar; luego recarga', async () => {
    const revisar = vi.fn(async () => ({ ok: true, status: 'applied' }))
    const f = falso([{ data: rev([caso()]), error: null }])
    render(<RevisionEconomica cliente={f.c} revisar={revisar} />); await esperar()
    fireEvent.click(screen.getByTestId('revision-verificar')); await esperar()
    expect(f.llamadas).toHaveLength(2)   // releída antes de advertir (estado actual)
    const adv = screen.getByTestId('revision-advertencia')
    expect(adv).toHaveTextContent('Este pedido está CANCELADO')
    expect(adv).toHaveTextContent('registrará dinero sobre un pedido cancelado')
    expect(adv).toHaveTextContent('no se reembolsa automáticamente')
    expect(revisar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('revision-confirmar-verificar')); await esperar()
    expect(revisar).toHaveBeenCalledWith('CL-1', 'verificar', null)
    expect(f.llamadas).toHaveLength(3)   // recarga tras la operación canónica
  })
  it('cancelar la advertencia no ejecuta nada', async () => {
    const revisar = vi.fn()
    render(<RevisionEconomica cliente={falso([{ data: rev([caso()]), error: null }]).c} revisar={revisar} />); await esperar()
    fireEvent.click(screen.getByTestId('revision-verificar')); await esperar()
    fireEvent.click(within(screen.getByTestId('revision-advertencia')).getByText('Cancelar'))
    expect(screen.queryByTestId('revision-advertencia')).toBeNull(); expect(revisar).not.toHaveBeenCalled()
  })
  it('rechazar exige motivo; con motivo usa revisar_pago con ese motivo', async () => {
    const revisar = vi.fn(async () => ({ ok: true, status: 'applied' }))
    render(<RevisionEconomica cliente={falso([{ data: rev([caso()]), error: null }]).c} revisar={revisar} />); await esperar()
    fireEvent.click(screen.getByTestId('revision-rechazar'))
    fireEvent.click(screen.getByTestId('revision-confirmar-rechazo'))
    expect(screen.getByTestId('revision-mensaje')).toHaveTextContent('necesita un motivo'); expect(revisar).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('revision-motivo'), { target: { value: 'no llegó a la cuenta' } })
    fireEvent.click(screen.getByTestId('revision-confirmar-rechazo')); await esperar()
    expect(revisar).toHaveBeenCalledWith('CL-1', 'rechazar', 'no llegó a la cuenta')
  })
  it('un error del servidor se muestra (no se presenta como éxito)', async () => {
    const revisar = vi.fn(async () => ({ ok: false, error: 'YA_VERIFICADO: no se puede rechazar un pago ya verificado' }))
    render(<RevisionEconomica cliente={falso([{ data: rev([caso()]), error: null }]).c} revisar={revisar} />); await esperar()
    fireEvent.click(screen.getByTestId('revision-verificar')); await esperar()
    fireEvent.click(screen.getByTestId('revision-confirmar-verificar')); await esperar()
    await waitFor(() => expect(screen.getByTestId('revision-mensaje')).toHaveTextContent('YA_VERIFICADO'))
    expect(screen.getByTestId('revision-mensaje').getAttribute('role')).toBe('alert')
  })
})

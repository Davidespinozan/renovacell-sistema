// @vitest-environment jsdom
// CS-1A.6 · superficie administrativa: lista de intentos por atender, acciones por estado, motivo obligatorio, resultado y
// bitácora sin datos sensibles. Todo simulado.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ConciliacionTarjeta } from './ConciliacionTarjeta'
import type { DepsConciliacion } from './ConciliacionTarjeta'
import type { IntentoAdmin } from '../../data/payments/cybersourceConciliar'

beforeEach(cleanup)
const base: IntentoAdmin = { id: '11111111-1111-4111-8111-111111111111', order_id: '22222222-2222-4222-8222-222222222222', folio: 'S100002', ambiente: 'test', amount: 6000, status: 'unknown_requires_reconciliation', status_at: '2026-10-20T15:00:00Z', created_at: '2026-10-20T14:50:00Z', cs_payment_id: '7000000000000000001', cs_payment_status: null, cs_reason: null, cs_request_sent_at: '2026-10-20T14:55:00Z', entry_id: null, error_safe: 'autorización: sin respuesta en 30000 ms', reconciled_at: null, reconcile_note: null }
function deps(intentos: IntentoAdmin[], conciliarResp: unknown = { ok: true, data: { estado: 'posted', aplicado: true, message: 'ok' } }) {
  const llamadas: Array<[string, string, string | undefined]> = []
  return {
    llamadas,
    listar: vi.fn(async () => ({ ok: true as const, intentos })),
    eventos: vi.fn(async () => [{ id: 1, from_status: 'authz_sent', to_status: 'unknown_requires_reconciliation', actor: null, actor_role: 'service_role', detalle: { error: 'timeout' }, created_at: '2026-10-20T15:00:00Z' }]),
    conciliar: vi.fn(async (acc: string, id: string, motivo?: string, extra?: Record<string, unknown>) => { llamadas.push(extra ? [acc, id, motivo, extra] as unknown as [string, string, string | undefined] : [acc, id, motivo]); return conciliarResp }),
  } as unknown as DepsConciliacion & { llamadas: typeof llamadas }
}

describe('CS-1A.6 · ConciliacionTarjeta', () => {
  it('lista, abre el detalle con bitácora y ofrece solo las acciones del estado; el id de pago se muestra acortado', async () => {
    const d = deps([base, { ...base, id: '33333333-3333-4333-8333-333333333333', status: 'authorized', folio: 'S100003' }, { ...base, id: '44444444-4444-4444-8444-444444444444', status: 'captured', folio: 'S100004' }])
    render(<ConciliacionTarjeta deps={d} />)
    await waitFor(() => expect(screen.getByTestId('ct-contador').textContent).toBe('3 por atender'))
    const filas = screen.getAllByTestId('ct-intento'); expect(filas).toHaveLength(3)
    expect(filas[0].textContent).toContain('S100002'); expect(filas[0].textContent).toContain('Resultado desconocido'); expect(filas[0].textContent).toContain('…000001'); expect(filas[0].textContent).not.toContain('7000000000000000001')
    fireEvent.click(screen.getAllByTestId('ct-abrir')[0])
    await screen.findByTestId('ct-detalle')
    expect(screen.getByTestId('ct-bitacora').textContent).toContain('authz_sent → unknown_requires_reconciliation')
    expect(screen.getByTestId('ct-consultar')).toBeTruthy(); expect(screen.getByTestId('ct-resolver')).toBeTruthy()
    expect(screen.queryByTestId('ct-capturar')).toBeNull(); expect(screen.queryByTestId('ct-reversar')).toBeNull(); expect(screen.queryByTestId('ct-contabilizar')).toBeNull()
    fireEvent.click(screen.getAllByTestId('ct-abrir')[1]); await waitFor(() => expect(screen.getByTestId('ct-capturar')).toBeTruthy()); expect(screen.getByTestId('ct-reversar')).toBeTruthy()
    fireEvent.click(screen.getAllByTestId('ct-abrir')[2]); await waitFor(() => expect(screen.getByTestId('ct-contabilizar')).toBeTruthy()); expect(screen.queryByTestId('ct-capturar')).toBeNull()
  })
  it('resolver exige motivo; con motivo llama a la Edge y muestra el resultado y el hallazgo bancario', async () => {
    const d = deps([base], { ok: true, data: { estado: 'posted', aplicado: true, message: 'captura aceptada por el proveedor', hallazgo: { autorizacion: { estado: 'aprobada' }, captura: { estado: 'aprobada' }, reversa: { estado: 'ninguna' } } } })
    render(<ConciliacionTarjeta deps={d} />)
    await screen.findAllByTestId('ct-intento'); fireEvent.click(screen.getByTestId('ct-abrir')); await screen.findByTestId('ct-detalle')
    fireEvent.click(screen.getByTestId('ct-resolver'))
    await waitFor(() => expect(screen.getByTestId('ct-resultado').textContent).toContain('mínimo 5'))
    expect(d.llamadas).toHaveLength(0)
    fireEvent.change(screen.getByTestId('ct-motivo'), { target: { value: 'Timeout de ayer; verificar en banco' } })
    fireEvent.click(screen.getByTestId('ct-resolver'))
    await waitFor(() => expect(d.llamadas).toEqual([['resolver', base.id, 'Timeout de ayer; verificar en banco']]))
    await waitFor(() => expect(screen.getByTestId('ct-resultado').textContent).toContain('Contabilizado'))
    expect(screen.getByTestId('ct-resultado').textContent).toContain('banco: auth aprobada, captura aprobada')
  })
  it('consultar no exige motivo y muestra la sugerencia; capturar/reversar piden confirmación; error del servidor se muestra', async () => {
    const d = deps([{ ...base, status: 'authorized' }], { ok: true, data: { estado: 'authorized', hallazgo: { autorizacion: { estado: 'aprobada' }, captura: { estado: 'ninguna' }, reversa: { estado: 'ninguna' } }, sugerencia: { accion: 'sin_cambio', motivo: 'autorización vigente sin captura: decide capturar o reversar' } } })
    render(<ConciliacionTarjeta deps={d} />)
    await screen.findAllByTestId('ct-intento'); fireEvent.click(screen.getByTestId('ct-abrir')); await screen.findByTestId('ct-detalle')
    fireEvent.click(screen.getByTestId('ct-consultar'))
    await waitFor(() => expect(d.llamadas).toEqual([['consultar', base.id, undefined]]))
    await waitFor(() => expect(screen.getByTestId('ct-resultado').textContent).toContain('sugerencia: sin_cambio'))
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.change(screen.getByTestId('ct-motivo'), { target: { value: 'Cliente pidió cancelar' } })
    fireEvent.click(screen.getByTestId('ct-reversar'))
    expect(confirmar).toHaveBeenCalled(); expect(d.llamadas).toHaveLength(1)   // cancelado en el confirm → sin llamada
    confirmar.mockRestore()
    cleanup()
    const d2 = deps([{ ...base, status: 'captured' }], { ok: false, error: 'contabilizacion_fallida', message: 'uq_entry_external_ref', estado: 'captured' })
    render(<ConciliacionTarjeta deps={d2} />)
    await screen.findAllByTestId('ct-intento'); fireEvent.click(screen.getByTestId('ct-abrir')); await screen.findByTestId('ct-detalle')
    fireEvent.click(screen.getByTestId('ct-contabilizar'))
    await waitFor(() => expect(screen.getByTestId('ct-resultado').textContent).toContain('uq_entry_external_ref (estado: captured)'))
  })
  it('CS-1A.7 · cierre manual: solo en "Resultado desconocido"; antes de 24 h el botón está deshabilitado; con plazo exige casilla de Business Center, motivo ≥ 10 y confirmación; nunca se ofrece "marcar capturado"', async () => {
    const reciente = { ...base, cs_request_sent_at: new Date(Date.now() - 3 * 3600000).toISOString(), status_at: new Date(Date.now() - 2 * 3600000).toISOString() }
    const d = deps([reciente, { ...base, id: '33333333-3333-4333-8333-333333333333', status: 'authorized', folio: 'S100003' }])
    render(<ConciliacionTarjeta deps={d} />)
    await screen.findAllByTestId('ct-intento'); fireEvent.click(screen.getAllByTestId('ct-abrir')[0]); await screen.findByTestId('ct-detalle')
    expect(screen.getByTestId('ct-cierre-manual')).toBeTruthy()
    expect(screen.getByTestId('ct-cierre-horas').textContent).toMatch(/Disponible en 22 h/)
    expect((screen.getByTestId('ct-cerrar-manual') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('ct-cierre-manual').textContent).toMatch(/no demuestran que no hubo cargo/)
    fireEvent.click(screen.getAllByTestId('ct-abrir')[1]); await waitFor(() => expect(screen.getByTestId('ct-capturar')).toBeTruthy())
    expect(screen.queryByTestId('ct-cierre-manual')).toBeNull()   // una autorización vigente no se "cierra sin cargo"
    expect(document.body.textContent).not.toMatch(/marcar como capturad|marcar capturad/i)
    cleanup()
    const viejo = { ...base, cs_request_sent_at: new Date(Date.now() - 30 * 3600000).toISOString(), status_at: new Date(Date.now() - 26 * 3600000).toISOString() }
    const d2 = deps([viejo], { ok: true, data: { estado: 'failed_safe_to_retry', aplicado: true, message: 'Cerrado sin cargo por billing:abc tras 26 h; la reserva quedó liberada.', hallazgo: { autorizacion: { estado: 'ninguna' }, captura: { estado: 'ninguna' }, reversa: { estado: 'ninguna' } } } })
    render(<ConciliacionTarjeta deps={d2} />)
    await screen.findAllByTestId('ct-intento'); fireEvent.click(screen.getByTestId('ct-abrir')); await screen.findByTestId('ct-detalle')
    expect(screen.getByTestId('ct-cierre-horas').textContent).toMatch(/Plazo cumplido/)
    const btn = screen.getByTestId('ct-cerrar-manual') as HTMLButtonElement; expect(btn.disabled).toBe(false)
    fireEvent.change(screen.getByTestId('ct-motivo'), { target: { value: 'cort' } })   // 4 < 5: regla general
    fireEvent.click(btn); await waitFor(() => expect(screen.getByTestId('ct-resultado').textContent).toContain('mínimo 5'))
    fireEvent.change(screen.getByTestId('ct-motivo'), { target: { value: 'ocho car' } })   // 8 < 10
    fireEvent.click(btn); await waitFor(() => expect(screen.getByTestId('ct-resultado').textContent).toContain('al menos 10'))
    fireEvent.change(screen.getByTestId('ct-motivo'), { target: { value: 'Cliente confirma sin cargo; BC vacío' } })
    fireEvent.click(btn); await waitFor(() => expect(screen.getByTestId('ct-resultado').textContent).toContain('Business Center'))
    expect(d2.llamadas).toHaveLength(0)   // sin casilla no hay llamada
    fireEvent.click(screen.getByTestId('ct-bc-revisado'))
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(btn); expect(confirmar).toHaveBeenCalledWith(expect.stringMatching(/SIN CARGO.*responsable/s)); expect(d2.llamadas).toHaveLength(0)
    confirmar.mockReturnValue(true)
    fireEvent.click(btn)
    await waitFor(() => expect(d2.llamadas).toEqual([['cerrar_manual', base.id, 'Cliente confirma sin cargo; BC vacío', { business_center_revisado: true }]]))
    await waitFor(() => expect(screen.getByTestId('ct-resultado').textContent).toContain('Cerrado sin cargo'))
    confirmar.mockRestore()
  })
  it('CS-1A.7 · el servidor rechaza (hallazgos, prematuro, consulta incompleta): se muestra el error y el intento sigue desconocido', async () => {
    const viejo = { ...base, cs_request_sent_at: new Date(Date.now() - 30 * 3600000).toISOString(), status_at: new Date(Date.now() - 26 * 3600000).toISOString() }
    const d = deps([viejo], { ok: false, error: 'hallazgos_existen', message: 'El proveedor sí registra transacciones de este intento: usa "resolver". No se cierra.', estado: 'unknown_requires_reconciliation' })
    render(<ConciliacionTarjeta deps={d} />)
    await screen.findAllByTestId('ct-intento'); fireEvent.click(screen.getByTestId('ct-abrir')); await screen.findByTestId('ct-detalle')
    fireEvent.change(screen.getByTestId('ct-motivo'), { target: { value: 'Cliente confirma sin cargo; BC vacío' } })
    fireEvent.click(screen.getByTestId('ct-bc-revisado'))
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByTestId('ct-cerrar-manual'))
    await waitFor(() => expect(screen.getByTestId('ct-resultado').textContent).toContain('No se cierra'))
    expect(screen.getByTestId('ct-resultado').textContent).toContain('(estado: unknown_requires_reconciliation)')
    confirmar.mockRestore()
  })
  it('sin pendientes: mensaje vacío', async () => {
    render(<ConciliacionTarjeta deps={deps([])} />)
    await screen.findByTestId('ct-vacio')
  })
})

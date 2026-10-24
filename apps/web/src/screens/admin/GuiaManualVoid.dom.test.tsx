// @vitest-environment jsdom
// DHL D1 · la rama "estado desconocido" del detalle de venta: Dirección consulta a DHL desde el servidor y decide con esa
// evidencia. Los botones solo se habilitan cuando el servidor tiene lo que el comando exige; la evidencia nunca se teclea.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ReconciliarGuia } from './GuiaManualVoid'
import type { ConsultaReconciliacion } from '../../data/shipping/reconciliarGuia'

const base: ConsultaReconciliacion = {
  intento: { id: 'A-1', creado: '2026-10-23T18:00:00Z', actualizado: null, horas: 2, referencia: 'abc123', servicio: 'N', con_snapshot: true, costo: null, moneda: null },
  consulta: { consultado_en: '2026-10-23T20:00:00Z', referencia: 'abc123', por_referencia: { realizada: true, resultado: 'sin_resultados', encontradas: [] } },
  guias_distintas: [], reglas: { minutos_minimos_sin_guia: 60, minutos_vigencia_consulta: 30, advertencia: 'Un 404 de DHL no prueba que la guía no exista.' },
}
const hallada = { tracking: '3143999482', referencias: ['abc123'], producto: 'N', destino_cp: '44100', peso_total: 1.2, piezas: 1, eventos: 0 }
beforeEach(() => cleanup())

describe('ReconciliarGuia', () => {
  it('sin consultar no hay decisiones; al consultar muestra la evidencia del servidor y la advertencia del 404', async () => {
    const consultar = vi.fn(async () => ({ ok: true as const, datos: base }))
    render(<ReconciliarGuia orderId="O-1" consultar={consultar as never} resolver={vi.fn() as never} />)
    expect(screen.queryByTestId('reconciliar-sin-guia')).toBeNull()
    fireEvent.click(screen.getByTestId('reconciliar-consultar'))
    await waitFor(() => expect(screen.getByTestId('reconciliar-consulta')).toBeTruthy())
    expect(consultar).toHaveBeenCalledWith('O-1', undefined)
    expect(screen.getByTestId('reconciliar-consulta').textContent).toMatch(/DHL no devolvió ninguna guía/)
    expect(screen.getByTestId('reconciliar-consulta').textContent).toMatch(/Un 404 de DHL no prueba/)
    expect((screen.getByTestId('reconciliar-sin-guia') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('reconciliar-confirmar') as HTMLButtonElement).disabled).toBe(true)
  })
  it('cerrar sin guía exige portal, riesgo aceptado y motivo; manda la decisión con las confirmaciones y el op_id', async () => {
    const resolver = vi.fn(async () => ({ ok: true as const, datos: { resultado: { status: 'applied', resolucion: 'sin_guia' as const, order_status: 'packed' }, etiqueta: 'no_aplica' as const } }))
    const onResuelto = vi.fn()
    render(<ReconciliarGuia orderId="O-1" consultar={(async () => ({ ok: true, datos: base })) as never} resolver={resolver as never} onResuelto={onResuelto} />)
    fireEvent.click(screen.getByTestId('reconciliar-consultar'))
    await waitFor(() => expect(screen.getByTestId('reconciliar-consulta')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Qué consultaste/), { target: { value: 'Consulté referencia y portal MyDHL: nada' } })
    fireEvent.click(screen.getByTestId('reconciliar-portal'))
    expect((screen.getByTestId('reconciliar-sin-guia') as HTMLButtonElement).disabled).toBe(true)   // falta aceptar el riesgo
    fireEvent.click(screen.getByTestId('reconciliar-acepta'))
    expect((screen.getByTestId('reconciliar-sin-guia') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('reconciliar-sin-guia'))
    await waitFor(() => expect(onResuelto).toHaveBeenCalled())
    expect(resolver).toHaveBeenCalledTimes(1)
    const [orderId, dec] = resolver.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(orderId).toBe('O-1')
    expect(dec).toMatchObject({ resolucion: 'sin_guia', portalRevisado: true, aceptaDuplicadoTardio: true, motivo: 'Consulté referencia y portal MyDHL: nada' })
    expect(typeof dec.opId).toBe('string')
    expect(onResuelto.mock.calls[0][0]).toMatch(/cerrado sin guía/)
  })
  it('con menos de 60 minutos o con hallazgos, cerrar sin guía queda deshabilitado aunque se marque todo', async () => {
    const reciente = { ...base, intento: { ...base.intento, horas: 0.5 } }
    render(<ReconciliarGuia orderId="O-1" consultar={(async () => ({ ok: true, datos: reciente })) as never} resolver={vi.fn() as never} />)
    fireEvent.click(screen.getByTestId('reconciliar-consultar'))
    await waitFor(() => expect(screen.getByTestId('reconciliar-consulta')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Qué consultaste/), { target: { value: 'Consulté referencia y portal MyDHL: nada' } })
    fireEvent.click(screen.getByTestId('reconciliar-portal')); fireEvent.click(screen.getByTestId('reconciliar-acepta'))
    expect((screen.getByTestId('reconciliar-sin-guia') as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    const conHallazgo = { ...base, guias_distintas: ['3143999482'], consulta: { ...base.consulta, por_referencia: { realizada: true, resultado: 'encontradas' as const, encontradas: [hallada] } } }
    render(<ReconciliarGuia orderId="O-1" consultar={(async () => ({ ok: true, datos: conHallazgo })) as never} resolver={vi.fn() as never} />)
    fireEvent.click(screen.getByTestId('reconciliar-consultar'))
    await waitFor(() => expect(screen.getByTestId('reconciliar-consulta')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Qué consultaste/), { target: { value: 'Consulté referencia y portal MyDHL: nada' } })
    fireEvent.click(screen.getByTestId('reconciliar-portal')); fireEvent.click(screen.getByTestId('reconciliar-acepta'))
    expect((screen.getByTestId('reconciliar-sin-guia') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('reconciliar-consulta').textContent).toMatch(/3143999482 · lleva la referencia del intento/)
  })
  it('registrar la guía exige que el número tecleado aparezca en la consulta del servidor y motivo; manda el tracking', async () => {
    const conHallazgo = { ...base, guias_distintas: ['3143999482'], consulta: { ...base.consulta, por_referencia: { realizada: true, resultado: 'encontradas' as const, encontradas: [hallada] } } }
    const resolver = vi.fn(async () => ({ ok: true as const, datos: { resultado: { status: 'applied', resolucion: 'guia_confirmada' as const, tracking: '3143999482', order_status: 'shipped', costo_pendiente: true }, etiqueta: 'no_disponible' as const } }))
    const onResuelto = vi.fn()
    render(<ReconciliarGuia orderId="O-1" consultar={(async () => ({ ok: true, datos: conHallazgo })) as never} resolver={resolver as never} onResuelto={onResuelto} />)
    fireEvent.click(screen.getByTestId('reconciliar-consultar'))
    await waitFor(() => expect(screen.getByTestId('reconciliar-consulta')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Qué consultaste/), { target: { value: 'La guía aparece en DHL con la referencia' } })
    expect((screen.getByTestId('reconciliar-confirmar') as HTMLButtonElement).disabled).toBe(true)   // sin número
    fireEvent.change(screen.getByPlaceholderText(/Ej\. 3143999482/), { target: { value: '3143999483' } })
    expect((screen.getByTestId('reconciliar-confirmar') as HTMLButtonElement).disabled).toBe(true)   // número que DHL no devolvió
    fireEvent.change(screen.getByPlaceholderText(/Ej\. 3143999482/), { target: { value: '3143999482' } })
    expect((screen.getByTestId('reconciliar-confirmar') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('reconciliar-confirmar'))
    await waitFor(() => expect(onResuelto).toHaveBeenCalled())
    expect((resolver.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).toMatchObject({ resolucion: 'guia_confirmada', tracking: '3143999482' })
    expect(onResuelto.mock.calls[0][0]).toMatch(/Guía 3143999482 registrada.*imprímela desde MyDHL.*costo de la guía quedó pendiente/)
  })
  it('un rechazo del servidor se muestra y no se da por resuelto', async () => {
    const resolver = vi.fn(async () => ({ ok: false as const, error: 'Aún no pasaron 60 minutos desde el intento. Espera antes de resolver sin guía.', ambiguo: false }))
    const onResuelto = vi.fn()
    render(<ReconciliarGuia orderId="O-1" consultar={(async () => ({ ok: true, datos: base })) as never} resolver={resolver as never} onResuelto={onResuelto} />)
    fireEvent.click(screen.getByTestId('reconciliar-consultar'))
    await waitFor(() => expect(screen.getByTestId('reconciliar-consulta')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Qué consultaste/), { target: { value: 'Consulté referencia y portal MyDHL: nada' } })
    fireEvent.click(screen.getByTestId('reconciliar-portal')); fireEvent.click(screen.getByTestId('reconciliar-acepta'))
    fireEvent.click(screen.getByTestId('reconciliar-sin-guia'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/60 minutos/))
    expect(onResuelto).not.toHaveBeenCalled()
  })
})

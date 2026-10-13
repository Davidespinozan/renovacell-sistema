// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { RecoleccionGuia } from './RecoleccionGuia'

const AHORA = () => Date.parse('2026-10-14T19:00:00Z')      // 12:00 en Culiacán
const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const llenar = () => { set('Listo desde', '13:00'); set('Pueden pasar hasta', '17:00') }
beforeEach(() => { cleanup(); window.confirm = vi.fn(() => true) })

describe('<RecoleccionGuia>', () => {
  it('sin recolección: ofrece agendar; el formulario valida antes de enviar', () => {
    const agendar = vi.fn()
    render(<RecoleccionGuia orderId="O-1" agendada={null} onCambio={() => {}} agendar={agendar} ahora={AHORA} />)
    fireEvent.click(screen.getByTestId('recoleccion-abrir'))
    expect((screen.getByTestId('recoleccion-pedir') as HTMLButtonElement).disabled).toBe(true)
    set('Listo desde', '13:00'); set('Pueden pasar hasta', '13:20')
    expect(screen.getByTestId('recoleccion-motivo').textContent).toMatch(/al menos una hora/)
    fireEvent.click(screen.getByTestId('recoleccion-pedir')); expect(agendar).not.toHaveBeenCalled()
  })
  it('agenda y muestra la confirmación; avisa para recargar', async () => {
    const agendar = vi.fn(async () => ({ ok: true as const, confirmation: 'PRG777' })), cambio = vi.fn()
    render(<RecoleccionGuia orderId="O-1" agendada={null} onCambio={cambio} agendar={agendar} ahora={AHORA} />)
    fireEvent.click(screen.getByTestId('recoleccion-abrir')); llenar()
    fireEvent.click(screen.getByTestId('recoleccion-pedir'))
    await waitFor(() => expect(screen.getByTestId('recoleccion-agendada').textContent).toContain('PRG777'))
    expect(agendar).toHaveBeenCalledWith('O-1', { date: '2026-10-14', ready: '13:00', close: '17:00', location: 'Recepción', instructions: '' })
    expect(cambio).toHaveBeenCalledTimes(1)
  })
  it('rechazo de la paquetería: se ve su motivo y el formulario sigue abierto con lo capturado', async () => {
    const agendar = vi.fn(async () => ({ ok: false as const, error: 'DHL 422: pickup time too late' }))
    render(<RecoleccionGuia orderId="O-1" agendada={null} onCambio={() => {}} agendar={agendar} ahora={AHORA} />)
    fireEvent.click(screen.getByTestId('recoleccion-abrir')); llenar()
    fireEvent.click(screen.getByTestId('recoleccion-pedir'))
    expect(await screen.findByRole('alert')).toHaveTextContent('pickup time too late')
    expect((screen.getByLabelText('Listo desde') as HTMLInputElement).value).toBe('13:00')
    expect(agendar).toHaveBeenCalledTimes(1)                 // sin reintento automático
  })
  it('recolección agendada: muestra datos y permite cancelar (con confirmación)', async () => {
    const cancelar = vi.fn(async () => ({ ok: true })), cambio = vi.fn()
    render(<RecoleccionGuia orderId="O-1" agendada={{ confirmation: 'PRG1', date: '2026-10-14', ready: '13:00', close: '17:00', location: 'Recepción' }} onCambio={cambio} cancelar={cancelar} ahora={AHORA} />)
    expect(screen.getByTestId('recoleccion-agendada').textContent).toMatch(/PRG1.*de 13:00 a 17:00.*Recepción/)
    fireEvent.click(screen.getByTestId('recoleccion-cancelar'))
    await waitFor(() => expect(cambio).toHaveBeenCalledTimes(1))
    expect(cancelar).toHaveBeenCalledWith('O-1', 'Cancelada por el remitente')
    cleanup(); window.confirm = vi.fn(() => false); cancelar.mockClear()
    render(<RecoleccionGuia orderId="O-1" agendada={{ confirmation: 'PRG1', date: '2026-10-14', ready: '13:00', close: '17:00', location: 'Recepción' }} onCambio={cambio} cancelar={cancelar} ahora={AHORA} />)
    fireEvent.click(screen.getByTestId('recoleccion-cancelar')); expect(cancelar).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom
// ENT-CFG · Dirección edita la regla de entrega en Configuración: lee del servidor, valida en palabras antes de mandar, guarda
// por entrega_config_guardar con números y días ordenados, y muestra el error del servidor sin perder lo escrito.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { EntregaConfigEditor, validarEntrega } from './EntregaConfigEditor'
import type { EntregaConfig } from '../../data/ops/entrega'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn() } }))
beforeEach(cleanup)
const CFG: EntregaConfig = { corte: '15:30:00', foraneo_gratis_desde: 5000, foraneo_costo: 600, local_gratis_desde: 500, local_costo: 0, cp_local_desde: '80000', cp_local_hasta: '80299',
  dias_paqueteria: [1, 2, 3, 4, 5], dias_chofer: [1, 2, 3, 4, 5, 6], dias_entrega_foranea: [1, 2, 3, 4, 5], dhl_transito_min: 1, dhl_transito_max: 3, t1_activo: false, t1_transito_min: 2, t1_transito_max: 5,
  local_mismo_dia: true, recoge_lugar: 'Sucursal Renovacell, Culiacán', recoge_horario: 'Lunes a sábado de 10:00 a 18:00' }

describe('ENT-CFG · regla de entrega', () => {
  it('lee la regla, no deja guardar sin cambios, y manda al comando los valores como números con los días ordenados', async () => {
    const guardar = vi.fn(async (d: Partial<EntregaConfig>) => ({ ok: true as const, data: { ...CFG, ...d } as EntregaConfig }))
    render(<EntregaConfigEditor ver={async () => ({ ok: true, data: CFG })} guardar={guardar} />)
    await waitFor(() => expect((screen.getByLabelText('Costo foráneo') as HTMLInputElement).value).toBe('600'))
    expect((screen.getByLabelText('Corte de salida') as HTMLInputElement).value).toBe('15:30')
    expect(screen.getByTestId('dias-paqueteria')).toHaveTextContent('lunes, martes, miércoles, jueves, viernes')
    expect((screen.getByTestId('entrega-guardar') as HTMLButtonElement).disabled).toBe(true)   // sin cambios
    fireEvent.change(screen.getByLabelText('Costo foráneo'), { target: { value: '$ 700' } })
    fireEvent.click(within(screen.getByTestId('dias-paqueteria')).getByRole('button', { name: 'sábado' }))   // paquetería también sale el sábado
    fireEvent.change(screen.getByLabelText('Lugar para recoger'), { target: { value: 'Blvd. Ejemplo 123, Culiacán ' } })
    expect((screen.getByTestId('entrega-guardar') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('entrega-guardar'))
    await waitFor(() => expect(guardar).toHaveBeenCalledTimes(1))
    const d = guardar.mock.calls[0][0]
    expect(d.foraneo_costo).toBe(700); expect(d.dias_paqueteria).toEqual([1, 2, 3, 4, 5, 6]); expect(d.recoge_lugar).toBe('Blvd. Ejemplo 123, Culiacán'); expect(d.corte).toBe('15:30'); expect(d.t1_activo).toBe(false)
    expect(await screen.findByTestId('entrega-aviso')).toHaveTextContent(/Regla de entrega guardada/)
    expect((screen.getByTestId('entrega-guardar') as HTMLButtonElement).disabled).toBe(true)   // ya está guardado
  })
  it('explica en palabras qué está mal y no manda nada; el error del servidor se muestra sin perder lo escrito', async () => {
    const guardar = vi.fn(async () => ({ ok: false as const, error: 'Solo Dirección cambia la regla de entrega.' }))
    render(<EntregaConfigEditor ver={async () => ({ ok: true, data: CFG })} guardar={guardar} />)
    await screen.findByLabelText('Costo foráneo')
    fireEvent.change(screen.getByLabelText('C.P. local hasta'), { target: { value: '7999' } })
    expect(screen.getByTestId('entrega-problema')).toHaveTextContent(/5 dígitos/)
    expect((screen.getByTestId('entrega-guardar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('C.P. local hasta'), { target: { value: '79999' } })
    expect(screen.getByTestId('entrega-problema')).toHaveTextContent(/mayor o igual/)
    fireEvent.change(screen.getByLabelText('C.P. local hasta'), { target: { value: '80500' } })
    expect(screen.queryByTestId('entrega-problema')).toBeNull()
    fireEvent.click(screen.getByTestId('entrega-guardar'))
    await waitFor(() => expect(guardar).toHaveBeenCalled())
    expect(screen.getByRole('alert')).toHaveTextContent(/Solo Dirección/)
    expect((screen.getByLabelText('C.P. local hasta') as HTMLInputElement).value).toBe('80500')
  })
  it('validación: días vacíos, tránsito invertido y sucursal sin texto', () => {
    const base = { corte: '15:30', foraneo_gratis_desde: '5000', foraneo_costo: '600', local_gratis_desde: '500', local_costo: '0', cp_local_desde: '80000', cp_local_hasta: '80299', dias_paqueteria: [1], dias_chofer: [1], dias_entrega_foranea: [1], dhl_transito_min: '1', dhl_transito_max: '3', t1_activo: false, t1_transito_min: '2', t1_transito_max: '5', local_mismo_dia: true, recoge_lugar: 'Sucursal', recoge_horario: '10 a 18' }
    expect(validarEntrega(base)).toBeNull()
    expect(validarEntrega({ ...base, dias_chofer: [] })).toMatch(/chofer/)
    expect(validarEntrega({ ...base, dhl_transito_min: '4' })).toMatch(/DHL/)
    expect(validarEntrega({ ...base, foraneo_costo: '-1' })).toMatch(/costo foráneo/)
    expect(validarEntrega({ ...base, recoge_lugar: 'x' })).toMatch(/sucursal/)
  })
})

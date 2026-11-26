// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { FacturaGlobal, mesAnterior } from './FacturaGlobal'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { functions: { invoke: vi.fn() } } }))
beforeEach(cleanup)

describe('pantalla factura global', () => {
  it('propone el mes anterior (enero → diciembre del año pasado)', () => {
    expect(mesAnterior('2026-12-02')).toEqual({ anio: 2026, mes: 11 })
    expect(mesAnterior('2027-01-03')).toEqual({ anio: 2026, mes: 12 })
  })
  it('muestra ventas, lo que falta y no deja timbrar si no está listo', async () => {
    const cliente = { globalPreparar: vi.fn(async () => ({ listo: false, configurado: true, entorno: 'produccion' as const, ventas: 34, ventas_total: 502560, faltantes: ['NABOTA 200 UI: su configuración fiscal no está validada.'], globales: [] })), globalTimbrar: vi.fn(), globalConciliar: vi.fn() }
    render(<FacturaGlobal cliente={cliente as never} />)
    await waitFor(() => expect(screen.getByTestId('fg-resumen').textContent).toMatch(/34 ventas sin factura/))
    expect(screen.getByTestId('fg-faltantes').textContent).toMatch(/no está validada/)
    expect((screen.getByTestId('fg-timbrar') as HTMLButtonElement).disabled).toBe(true)
  })
})

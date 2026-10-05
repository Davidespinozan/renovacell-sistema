// W5 · El cliente de los KPIs falla CERRADO: sin respuesta válida no hay cifra (nunca un cero).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: mocks.rpc } }))

import { leerKpiVentas, leerKpiPorCobrar, leerKpiResultado } from './kpis'

const P = { desde: '2026-10-01', hasta: '2026-10-31' }
const ventas = { ventas: 1, pedidos: 1, ticket: 1, cobrado_entradas: 1, cobrado_salidas: 0, cobrado_neto: 1, saldo_ventas: 0 }

beforeEach(() => mocks.rpc.mockReset())

describe('leerKpi*', () => {
  it('pasa el periodo tal cual (días del negocio) y devuelve números', async () => {
    mocks.rpc.mockResolvedValue({ data: ventas, error: null })
    const r = await leerKpiVentas(P)
    expect(mocks.rpc).toHaveBeenCalledWith('kpi_ventas', { p_desde: '2026-10-01', p_hasta: '2026-10-31' })
    expect(r).toEqual({ ok: true, data: ventas })
  })
  it('sin permiso → error con el motivo, no un cero', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'NO_AUTORIZADO: costo y utilidad son de Dirección' } })
    const r = await leerKpiResultado(P)
    expect(r).toEqual({ ok: false, error: 'El costo y la utilidad solo los ve Dirección.' })
  })
  it('respuesta con forma inesperada → error', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...ventas, ventas: 'muchas' }, error: null })
    expect((await leerKpiVentas(P)).ok).toBe(false)
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    expect((await leerKpiPorCobrar()).ok).toBe(false)
  })
  it('falla de red (promesa rechazada o excepción) → error, nunca una cifra', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('Load failed'))
    expect(await leerKpiPorCobrar()).toEqual({ ok: false, error: 'No se pudieron cargar los indicadores. Vuelve a intentarlo.' })
    mocks.rpc.mockImplementationOnce(() => { throw new Error('red') })
    expect((await leerKpiVentas(P)).ok).toBe(false)
  })
  it('un resultado con costo no confiable y utilidad numérica es incoherente → se descarta', async () => {
    const base = { ventas: 1, devoluciones: 0, ventas_netas: 1, unidades_vendidas: 1, unidades_sin_costo: 1, unidades_sin_surtir: 0,
      cobertura_pct: 0, costo_ventas_conocido: 0, gastos: 0, mermas_conocidas: 0, merma_unidades_sin_costo: 0,
      costo_confiable: false, utilidad_neta_confiable: false, costo_ventas: null, utilidad_bruta: 5, margen_bruto_pct: null, utilidad_neta: null, margen_neto_pct: null }
    mocks.rpc.mockResolvedValue({ data: base, error: null })
    expect((await leerKpiResultado(P)).ok).toBe(false)
    mocks.rpc.mockResolvedValue({ data: { ...base, utilidad_bruta: null }, error: null })
    const ok = await leerKpiResultado(P)
    expect(ok.ok && ok.data.utilidad_bruta).toBeNull()
  })
})

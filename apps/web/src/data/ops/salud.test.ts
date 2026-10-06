// W6-A3.2 · El cliente de salud falla cerrado y nunca deja pasar texto crudo del servidor.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), hasSupabase: true }))
vi.mock('../../lib/supabase', () => ({ get hasSupabase() { return mocks.hasSupabase }, supabase: { rpc: mocks.rpc } }))

import { normalizarSalud, leerSalud, esProblema, SALUD_NO_DISPONIBLE, SALUD_SOLO_DIRECCION } from './salud'

const ok = { fuente: 'alertas_diarias', estado: 'OK', mensaje: null, ultimo_ok: '2026-10-05T21:26:14Z', horas_desde_ok: 0.2, procesados: 0, cron: { disponible: true } }

beforeEach(() => { mocks.rpc.mockReset(); mocks.hasSupabase = true })

describe('normalizarSalud', () => {
  it('acepta la forma real del servidor (contrato comprobado en producción)', () => {
    expect(normalizarSalud(ok)).toEqual({ fuente: 'alertas_diarias', estado: 'OK', mensaje: null, ultimo_ok: '2026-10-05T21:26:14Z', horas_desde_ok: 0.2, procesados: 0 })
  })
  it('rechaza estados desconocidos, listas, nulos y tipos incorrectos', () => {
    expect(normalizarSalud(null)).toBeNull()
    expect(normalizarSalud([])).toBeNull()
    expect(normalizarSalud({ ...ok, estado: 'VERDE' })).toBeNull()
    expect(normalizarSalud({ ...ok, mensaje: 7 })).toBeNull()
    expect(normalizarSalud({ ...ok, horas_desde_ok: 'ayer' })).toBeNull()
    expect(normalizarSalud({ ...ok, fuente: '' })).toBeNull()
  })
  it('un problema sin mensaje del servidor no se acepta: el frontend no redacta', () => {
    expect(normalizarSalud({ ...ok, estado: 'FAILED', mensaje: null })).toBeNull()
    expect(normalizarSalud({ ...ok, estado: 'STALE', mensaje: '  ' })).toBeNull()
    expect(normalizarSalud({ ...ok, estado: 'FAILED', mensaje: 'La última ejecución falló (x).' })?.estado).toBe('FAILED')
  })
  it('esProblema sigue la clasificación del servidor: RUNNING no es problema', () => {
    expect(esProblema(normalizarSalud({ ...ok, estado: 'RUNNING', mensaje: 'Las alertas automáticas se están ejecutando.' })!)).toBe(false)
    expect(esProblema(normalizarSalud({ ...ok, estado: 'STALE', mensaje: 'Alertas automáticas sin ejecutarse correctamente desde el 01/10/2026 09:00.' })!)).toBe(true)
  })
})

describe('leerSalud', () => {
  it('sin backend → sin_backend (no es sano ni error)', async () => {
    mocks.hasSupabase = false
    expect(await leerSalud()).toEqual({ ok: false, sinBackend: true })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('llama a la RPC canónica y devuelve la salud normalizada', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: ok, error: null })
    const r = await leerSalud()
    expect(mocks.rpc).toHaveBeenCalledWith('salud_sistema')
    expect(r.ok && r.data.estado).toBe('OK')
  })
  it('NO_AUTORIZADO → mensaje de autoridad, sin texto del servidor', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'NO_AUTORIZADO: la salud del sistema es de Dirección' } })
    expect(await leerSalud()).toEqual({ ok: false, error: SALUD_SOLO_DIRECCION })
  })
  it('otro error / respuesta malformada / excepción → "No se pudo consultar…", nunca sano ni crudo', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'ERROR: relation "cron.job" does not exist CONTEXT: PL/pgSQL' } })
    expect(await leerSalud()).toEqual({ ok: false, error: SALUD_NO_DISPONIBLE })
    mocks.rpc.mockResolvedValueOnce({ data: { estado: 'OK' }, error: null })
    expect(await leerSalud()).toEqual({ ok: false, error: SALUD_NO_DISPONIBLE })
    mocks.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
    const r = await leerSalud()
    expect(r).toEqual({ ok: false, error: SALUD_NO_DISPONIBLE })
    expect(JSON.stringify(r)).not.toMatch(/cron|PL\/pgSQL|CONTEXT|fetch/)
  })
})

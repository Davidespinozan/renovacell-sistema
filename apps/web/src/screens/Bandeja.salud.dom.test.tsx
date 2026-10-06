// @vitest-environment jsdom
// W6-A3.2 · La bandeja muestra la salud del sistema a Dirección SOLO cuando el servidor
// reporta un problema o cuando no se pudo consultar; nunca "todo al día" con la consulta rota.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

const srv = vi.hoisted(() => ({
  role: 'admin' as string,
  salud: { estado: 'OK', mensaje: null as string | null } as Record<string, unknown> | null,
  rpcError: null as string | null,
  llamadas: 0,
}))
vi.mock('../auth/RoleContext', () => ({ useRole: () => ({ role: srv.role, setScreen: vi.fn(), user: { email: 'x@y.mx' } }) }))
vi.mock('../data/hooks/useOrders', () => ({ useAllOrders: () => ({ data: [] }) }))
vi.mock('../data/hooks/useMoney', () => ({ useOrderMoney: () => ({ byOrder: {} }), usePaymentClaims: () => ({ data: [] }) }))
vi.mock('../data/hooks/useShipments', () => ({ useShipments: () => ({ data: [] }) }))
vi.mock('../data/hooks/useLots', () => ({ useLots: () => ({ data: [] }) }))
vi.mock('../data/hooks/useDoctors', () => ({ useDoctors: () => ({ data: [] }) }))
vi.mock('../data/hooks/useProspects', () => ({ useProspects: () => ({ data: [] }) }))
vi.mock('../data/hooks/useStockReturns', () => ({ useStockReturns: () => ({ data: [] }) }))
vi.mock('../data/hooks/useCompras', () => ({ useCompras: () => ({ data: [] }) }))
vi.mock('../data/hooks/useCustody', () => ({ useCustodies: () => ({ data: [] }) }))
vi.mock('../data/hooks/useRevisionFiscal', () => ({ useRevisionFiscal: () => ({ avance: { total: 0, validados: 0 }, loading: false }) }))
// CC-7 · la tarjeta de atención comercial tiene su propia prueba; aquí se aísla A3.2 (sin RPC de ruteo).
vi.mock('../data/ops/atencion', () => ({ atencion: { resumen: async () => ({ ok: false, error: 'aislado' }) } }))
vi.mock('../data/hooks/useComunicaciones', () => ({ useComunicaciones: () => ({ cuentas: { porEnviar: 0, enviados: 0, conProblema: 0 }, loading: false }) }))
// El "servidor": la RPC canónica. El hook y el cliente son los reales.
vi.mock('../lib/supabase', () => ({
  hasSupabase: true, currentUserId: () => 'u',
  supabase: { rpc: async (fn: string) => {
    srv.llamadas += 1
    if (fn !== 'salud_sistema') throw new Error('rpc inesperada ' + fn)
    return srv.rpcError ? { data: null, error: { message: srv.rpcError } } : { data: srv.salud, error: null }
  } },
}))

import { Bandeja } from './Bandeja'

const base = { fuente: 'alertas_diarias', ultimo_ok: '2026-10-05T21:26:14Z', horas_desde_ok: 1, procesados: 0 }
const esperar = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => { cleanup(); Object.assign(srv, { role: 'admin', salud: { ...base, estado: 'OK', mensaje: null }, rpcError: null, llamadas: 0 }) })

describe('ColaSalud', () => {
  it('A) OK → ninguna tarjeta, "Todo al día" y 0 llamadas a objetos internos', async () => {
    render(<Bandeja />); await esperar()
    expect(screen.queryByText('Alertas automáticas con problema')).toBeNull()
    expect(screen.queryByText('Salud del sistema')).toBeNull()
    expect(screen.getByText('Todo al día')).toBeInTheDocument()
    expect(srv.llamadas).toBe(1)
  })
  it('B) FAILED → tarjeta con el mensaje del servidor y cuenta 1', async () => {
    srv.salud = { ...base, estado: 'FAILED', mensaje: 'La última ejecución de las alertas automáticas falló (el almacén no respondió).' }
    render(<Bandeja />); await esperar()
    expect(screen.getByText('Alertas automáticas con problema')).toBeInTheDocument()
    expect(screen.getByText(/falló \(el almacén no respondió\)/)).toBeInTheDocument()
    expect(document.body.textContent).toMatch(/1 pendiente\(s\)/)
    expect(screen.queryByText('Todo al día')).toBeNull()
    expect(screen.queryByRole('button', { name: /Alertas automáticas/ })).toBeNull() // sin CTA
  })
  it('C) STALE → tarjeta visible', async () => {
    srv.salud = { ...base, estado: 'STALE', mensaje: 'Alertas automáticas sin ejecutarse correctamente desde el 03/10/2026 09:00.' }
    render(<Bandeja />); await esperar()
    expect(screen.getByText(/sin ejecutarse correctamente desde el 03\/10\/2026/)).toBeInTheDocument()
  })
  it('D) RUNNING (el servidor no lo marca como problema) → ninguna tarjeta', async () => {
    srv.salud = { ...base, estado: 'RUNNING', mensaje: 'Las alertas automáticas se están ejecutando.' }
    render(<Bandeja />); await esperar()
    expect(screen.queryByText('Alertas automáticas con problema')).toBeNull()
    expect(screen.getByText('Todo al día')).toBeInTheDocument()
  })
  it('E) un proceso muerto llega como FAILED desde el servidor (sin umbrales en el frontend) → tarjeta', async () => {
    srv.salud = { ...base, estado: 'FAILED', mensaje: 'La última ejecución de las alertas automáticas falló (la ejecución no terminó).' }
    render(<Bandeja />); await esperar()
    expect(screen.getByText(/la ejecución no terminó/)).toBeInTheDocument()
  })
  it('F) la RPC falla → advertencia "No se pudo consultar…", cuenta 1, nunca "Todo al día"', async () => {
    srv.rpcError = 'ERROR: relation "cron.job_run_details" does not exist CONTEXT: PL/pgSQL function salud_sistema() line 9'
    render(<Bandeja />); await esperar()
    expect(screen.getByText('Salud del sistema')).toBeInTheDocument()
    expect(screen.getByText('No se pudo consultar la salud del sistema.')).toBeInTheDocument()
    expect(screen.queryByText('Todo al día')).toBeNull()
    expect(document.body.textContent).not.toMatch(/cron\.|PL\/pgSQL|CONTEXT|relation/)
  })
  it('G) respuesta malformada → se trata como error de lectura (fail-closed)', async () => {
    srv.salud = { estado: 'OK' } // sin fuente ni mensaje
    render(<Bandeja />); await esperar()
    expect(screen.getByText('No se pudo consultar la salud del sistema.')).toBeInTheDocument()
    srv.salud = { ...base, estado: 'FAILED', mensaje: null } // problema sin mensaje: no se inventa texto
    cleanup(); render(<Bandeja />); await esperar()
    expect(screen.getByText('No se pudo consultar la salud del sistema.')).toBeInTheDocument()
  })
  it('H) al volver a consultar y estar OK, la tarjeta desaparece', async () => {
    srv.salud = { ...base, estado: 'STALE', mensaje: 'Alertas automáticas sin ejecutarse correctamente desde el 03/10/2026 09:00.' }
    render(<Bandeja />); await esperar()
    expect(screen.getByText('Alertas automáticas con problema')).toBeInTheDocument()
    srv.salud = { ...base, estado: 'OK', mensaje: null }
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); await Promise.resolve() })
    expect(screen.queryByText('Alertas automáticas con problema')).toBeNull()
    expect(screen.getByText('Todo al día')).toBeInTheDocument()
  })
  it('I) otro rol: no se consulta ni se muestra nada de salud (sin fuga al cambiar de rol)', async () => {
    srv.salud = { ...base, estado: 'FAILED', mensaje: 'La última ejecución de las alertas automáticas falló (x).' }
    srv.role = 'warehouse'
    const r = render(<Bandeja />); await esperar()
    expect(screen.queryByText('Alertas automáticas con problema')).toBeNull()
    expect(srv.llamadas).toBe(0)
    srv.role = 'pos'; r.rerender(<Bandeja />); await esperar()
    expect(screen.queryByText('Alertas automáticas con problema')).toBeNull()
    expect(srv.llamadas).toBe(0)
  })
  it('la cuenta nunca pasa de 1 por salud, aunque el servidor reporte varios fallos', async () => {
    srv.salud = { ...base, estado: 'FAILED', mensaje: 'La última ejecución de las alertas automáticas falló (x).', cron: { fallidas_7d: 35 } }
    render(<Bandeja />); await esperar()
    expect(document.body.textContent).toMatch(/1 pendiente\(s\)/)
    expect(document.body.textContent).not.toMatch(/35/)
  })
})

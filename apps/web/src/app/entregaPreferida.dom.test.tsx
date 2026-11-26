// @vitest-environment jsdom
// ENTREGA PREFERIDA (26 nov 2026, dueño): la opción que el cliente ya tiene se elige sola; si no aplica, la sugerida;
// si el vendedor elige otra a mano, no se le regresa.
import React, { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SelectorEntrega } from './SelectorEntrega'
import type { EleccionEntregaServidor, OpcionesEntrega } from '../data/ops/entrega'
import mig from '../../../../supabase/migrations/20270407990000_entrega_preferida_cliente.sql?raw'

vi.mock('../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn() } }))
beforeEach(cleanup)

const op = (id: string, tipo: 'foraneo' | 'recoge' | 'local', paqueteria: string | null, disponible = true) =>
  ({ id, tipo, paqueteria, flete: 600, permitido: true, motivo: null, disponible, salida: '2026-11-26', antes_de_corte: true, llega_desde: '2026-11-27', llega_hasta: '2026-11-30', texto: id })
const OPS = { actor: 'staff', subtotal: 1000, cp: '64000', local: false, corte: { hora: '15:30', zona: 'America/Mazatlan', antes_de_corte: true, hoy: '2026-11-26' },
  regla: { foraneo_gratis_desde: 5000, foraneo_flete: 600, local_gratis_desde: 500 }, recoge: { lugar: 'Sucursal', horario: '' }, sugerida: 'foraneo_dhl',
  opciones: [op('recoge', 'recoge', null), op('foraneo_dhl', 'foraneo', 'dhl'), op('foraneo_estafeta', 'foraneo', 'estafeta'), op('foraneo_t1', 'foraneo', 't1', false)] } as unknown as OpcionesEntrega
const cargar = async () => ({ ok: true as const, data: OPS })

function Arnes({ preferida }: { preferida: string | null }) {
  const [v, setV] = useState<EleccionEntregaServidor | null>(null)
  return (<div><SelectorEntrega preferida={preferida} subtotal={1000} cp="64000" value={v} onChange={(e) => setV(e)} cargar={cargar as never} /><pre data-testid="valor">{JSON.stringify(v)}</pre></div>)
}
const valor = () => JSON.parse(screen.getByTestId('valor').textContent || 'null')

describe('entrega preferida del cliente', () => {
  it('se elige sola en lugar de la sugerida', async () => {
    render(<Arnes preferida="foraneo_estafeta" />)
    await waitFor(() => expect(valor()?.opcion).toBe('foraneo_estafeta'))
  })
  it('si la preferida no está disponible, queda la sugerida', async () => {
    render(<Arnes preferida="foraneo_t1" />)
    await waitFor(() => expect(valor()?.opcion).toBe('foraneo_dhl'))
  })
  it('elegir otra a mano gana sobre la preferida', async () => {
    render(<Arnes preferida="foraneo_estafeta" />)
    await waitFor(() => expect(valor()?.opcion).toBe('foraneo_estafeta'))
    fireEvent.click(screen.getAllByRole('radio')[0])
    await waitFor(() => expect(valor()?.opcion).toBe('recoge'))
  })
  it('servidor: solo Dirección/Facturación/Ventas la leen y guardan; formato validado', () => {
    expect(mig).toMatch(/auth_role\(\) not in \('admin', 'billing', 'pos'\)/)
    expect(mig).toMatch(/check \(entrega_preferida is null or entrega_preferida ~ '\^\[a-z_\]\{3,40\}\$'\)/)
    expect(mig).toMatch(/revoke all on function public\.cliente_entrega_preferida_guardar\(uuid, text\) from public, anon/)
  })
})

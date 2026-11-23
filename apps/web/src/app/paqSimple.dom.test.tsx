// @vitest-environment jsdom
// PAQ-SIMPLE (23 nov 2026) · el vendedor elige SOLO la paquetería (DHL o Estafeta): DHL muestra la llegada más tardía de los
// servicios permitidos de su cotización en vivo (ECONOMY SELECT no cuenta) y su promesa viaja con la elección; si la
// cotización falla, el rango de la regla; Estafeta, el rango de su regla. El precio es siempre el de la regla.
import React, { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SelectorEntrega } from './SelectorEntrega'
import type { CotizacionEnvio, EleccionEntregaServidor, OpcionesEntrega } from '../data/ops/entrega'

vi.mock('../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn() } }))
beforeEach(cleanup)

const op = (id: string, paq: string, extra: Record<string, unknown> = {}) => ({ id, tipo: 'foraneo', paqueteria: paq, flete: 600, permitido: true, motivo: null, disponible: true, salida: '2026-11-23', antes_de_corte: true, llega_desde: '2026-11-24', llega_hasta: '2026-11-26', texto: `Envío por ${paq}`, ...extra })
const OPS = {
  actor: 'staff', subtotal: 1000, cp: '44100', local: false,
  corte: { hora: '15:30', zona: 'America/Mazatlan', antes_de_corte: true, hoy: '2026-11-23' },
  regla: { foraneo_gratis_desde: 5000, foraneo_flete: 600, local_gratis_desde: 500 },
  recoge: { lugar: 'Sucursal', horario: 'L–S' }, sugerida: 'foraneo_dhl',
  opciones: [op('foraneo_dhl', 'dhl'), op('foraneo_estafeta', 'estafeta', { llega_desde: '2026-11-25', llega_hasta: '2026-11-27' }), op('foraneo_t1', 't1', { disponible: false })],
} as unknown as OpcionesEntrega
const COT: CotizacionEnvio = { cotizacion_id: 'cot-1', expira_at: new Date(Date.now() + 7_200_000).toISOString(), proveedor: 'dhl', servicios: [
  { codigo: '1', nombre: 'EXPRESS 12:00', costo: 420, llega_fecha: '2026-11-24' },
  { codigo: 'N', nombre: 'EXPRESS DOMESTIC', costo: 330, llega_fecha: '2026-11-25' },
] }

function Arnes({ cotizar }: { cotizar: NonNullable<React.ComponentProps<typeof SelectorEntrega>['cargarServicios']> }) {
  const [v, setV] = useState<EleccionEntregaServidor | null>(null)
  return (
    <div>
      <SelectorEntrega subtotal={1000} cp="44100" piezas={2} value={v} onChange={(e) => setV(e)} cargar={async () => ({ ok: true, data: OPS })} cargarServicios={cotizar} />
      <pre data-testid="valor">{JSON.stringify(v)}</pre>
    </div>
  )
}

describe('PAQ-SIMPLE · SelectorEntrega', () => {
  it('DHL: la fecha más tardía de la cotización, precio de la regla y la promesa viaja con la elección; sin lista de servicios', async () => {
    const cotizar = vi.fn(async () => ({ ok: true as const, data: COT }))
    render(<Arnes cotizar={cotizar} />)
    await waitFor(() => expect(screen.getByTestId('entrega-foraneo_dhl')).toHaveTextContent(/Llega el miércoles 25 de nov/))
    expect(cotizar).toHaveBeenCalledWith('44100', 2, undefined)
    expect(screen.getByTestId('entrega-foraneo_dhl')).toHaveTextContent(/\$600/)
    await waitFor(() => expect(JSON.parse(screen.getByTestId('valor').textContent!)).toEqual({ opcion: 'foraneo_dhl', servicio: { cotizacion_id: 'cot-1', codigo: 'N', llega_fecha: '2026-11-25' } }))
    expect(screen.queryByTestId('servicio-paqueteria')).toBeNull()
    expect(screen.queryByText(/más por llegar antes/)).toBeNull()
  })
  it('Estafeta: el rango de su regla, mismo precio; elegirla suelta la promesa de DHL', async () => {
    render(<Arnes cotizar={async () => ({ ok: true as const, data: COT })} />)
    await waitFor(() => expect(screen.getByTestId('valor').textContent).toContain('cot-1'))
    expect(screen.getByTestId('entrega-foraneo_estafeta')).toHaveTextContent(/^Estafeta/)
    expect(screen.getByTestId('entrega-foraneo_estafeta')).toHaveTextContent(/Llega entre el miércoles 25 de nov y el viernes 27 de nov/)
    expect(screen.getByTestId('entrega-foraneo_estafeta')).toHaveTextContent(/\$600/)
    fireEvent.click(screen.getByTestId('entrega-foraneo_estafeta'))
    await waitFor(() => expect(JSON.parse(screen.getByTestId('valor').textContent!)).toEqual({ opcion: 'foraneo_estafeta' }))
  })
  it('si DHL no responde: el rango de la regla, se avisa y se vende igual (sin promesa)', async () => {
    render(<Arnes cotizar={async () => ({ ok: false as const, error: 'DHL tardó demasiado: se usa la regla de entrega.' })} />)
    await waitFor(() => expect(screen.getByTestId('entrega-dhl-regla')).toHaveTextContent(/regla de entrega/))
    expect(screen.getByTestId('entrega-foraneo_dhl')).toHaveTextContent(/Llega entre el martes 24 de nov y el jueves 26 de nov/)
    expect(JSON.parse(screen.getByTestId('valor').textContent!)).toEqual({ opcion: 'foraneo_dhl' })
  })
  it('una cotización solo con ECONOMY SELECT no da promesa (G nunca cuenta)', async () => {
    const soloG: CotizacionEnvio = { ...COT, servicios: [{ codigo: 'G', nombre: 'ECONOMY SELECT', costo: 200, llega_fecha: '2026-11-30' }] }
    render(<Arnes cotizar={async () => ({ ok: true as const, data: soloG })} />)
    await waitFor(() => expect(screen.getByTestId('entrega-dhl-regla')).toBeInTheDocument())
    expect(screen.getByTestId('entrega-foraneo_dhl')).not.toHaveTextContent(/30 de nov/)
  })
})

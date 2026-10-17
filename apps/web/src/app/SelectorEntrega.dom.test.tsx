// @vitest-environment jsdom
// ENT-2 · Selector de entrega del personal: opciones del servidor con flete y promesa; sugerida preseleccionada;
// cambiar el flete exige motivo; la elección que viaja es {opcion} o {opcion, flete, motivo}; nunca una fecha inventada.
import React, { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SelectorEntrega, eleccionCompleta } from './SelectorEntrega'
import type { EleccionEntregaServidor, OpcionesEntrega } from '../data/ops/entrega'

vi.mock('../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn() } }))
beforeEach(cleanup)

const OPS: OpcionesEntrega = {
  actor: 'staff', subtotal: 1000, cp: '82000', local: false,
  corte: { hora: '15:30', zona: 'America/Mazatlan', antes_de_corte: true, hoy: '2026-10-21' },
  regla: { foraneo_gratis_desde: 5000, foraneo_flete: 600, local_gratis_desde: 500 },
  recoge: { lugar: 'Sucursal Renovacell, Culiacán', horario: 'L–S 10:00–18:00' },
  sugerida: 'foraneo_dhl',
  opciones: [
    { id: 'mostrador', tipo: 'mostrador', paqueteria: null, flete: 0, permitido: true, motivo: null, disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-21', llega_hasta: '2026-10-21', texto: 'Entrega en mostrador' },
    { id: 'recoge', tipo: 'recoge', paqueteria: null, flete: 0, permitido: true, motivo: null, disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-21', llega_hasta: '2026-10-21', texto: 'Recoger en Sucursal Renovacell, Culiacán' },
    { id: 'local_chofer', tipo: 'local', paqueteria: 'chofer', flete: 0, permitido: true, motivo: null, disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-21', llega_hasta: '2026-10-21', texto: 'Entrega local (chofer de Renovacell)' },
    { id: 'foraneo_dhl', tipo: 'foraneo', paqueteria: 'dhl', flete: 600, permitido: true, motivo: null, disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-22', llega_hasta: '2026-10-26', texto: 'Envío por DHL' },
    { id: 'foraneo_t1', tipo: 'foraneo', paqueteria: 't1', flete: 600, permitido: true, motivo: null, disponible: false, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-23', llega_hasta: '2026-10-28', texto: 'Envío por T1' },
  ],
}

function Arnes({ cargar, subtotal = 1000, cp = '82000' as string | null }: { cargar: typeof import('../data/ops/entrega').opcionesEntrega; subtotal?: number; cp?: string | null }) {
  const [v, setV] = useState<EleccionEntregaServidor | null>(null)
  const [ops, setOps] = useState<OpcionesEntrega | null>(null)
  return (
    <div>
      <SelectorEntrega subtotal={subtotal} cp={cp} value={v} onChange={(e, o) => { setV(e); setOps(o) }} cargar={cargar} />
      <pre data-testid="valor">{JSON.stringify(v)}</pre>
      <span data-testid="completa">{String(eleccionCompleta(v, ops))}</span>
    </div>
  )
}

describe('ENT-2 · SelectorEntrega', () => {
  it('pide las opciones al servidor (staff, importe, CP), preselecciona la sugerida y muestra flete y promesa', async () => {
    const cargar = vi.fn(async () => ({ ok: true as const, data: OPS }))
    render(<Arnes cargar={cargar} />)
    await waitFor(() => expect(screen.getByTestId('selector-entrega')).toBeInTheDocument())
    expect(cargar).toHaveBeenCalledWith('staff', 1000, '82000')
    expect(screen.getByTestId('valor')).toHaveTextContent('{"opcion":"foraneo_dhl"}')
    expect(screen.getByTestId('entrega-foraneo_dhl')).toHaveTextContent(/\$600/); expect(screen.getByTestId('entrega-foraneo_dhl')).toHaveTextContent(/Sale hoy · llega entre el jueves 22 oct y el lunes 26 oct/)
    expect(screen.getByTestId('entrega-local_chofer')).toHaveTextContent(/el CP no es de Culiacán/)
    expect(screen.getByTestId('entrega-foraneo_t1')).toHaveTextContent(/Pendiente de integrar/)
    expect(screen.getByTestId('entrega-foraneo_t1').querySelector('input')).toBeDisabled()
    expect(screen.getByTestId('completa')).toHaveTextContent('true')
  })
  it('cambiar el flete exige motivo; con motivo viaja {opcion, flete, motivo}; volver al de la regla lo quita', async () => {
    render(<Arnes cargar={async () => ({ ok: true, data: OPS })} />)
    await waitFor(() => expect(screen.getByTestId('entrega-ajustar')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('entrega-ajustar'))
    fireEvent.change(screen.getByTestId('entrega-flete'), { target: { value: '0' } })
    expect(screen.getByTestId('completa')).toHaveTextContent('false')
    expect(screen.getByTestId('entrega-motivo-falta')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('entrega-motivo'), { target: { value: 'Cortesía por volumen' } })
    expect(screen.getByTestId('valor')).toHaveTextContent('{"opcion":"foraneo_dhl","flete":0,"motivo":"Cortesía por volumen"}')
    expect(screen.getByTestId('completa')).toHaveTextContent('true')
    fireEvent.change(screen.getByTestId('entrega-flete'), { target: { value: '600' } })
    expect(screen.getByTestId('valor')).toHaveTextContent('{"opcion":"foraneo_dhl"}')
  })
  it('elegir otra opción limpia el ajuste; recoger muestra el lugar y el horario', async () => {
    render(<Arnes cargar={async () => ({ ok: true, data: OPS })} />)
    await waitFor(() => expect(screen.getByTestId('entrega-recoge')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('entrega-recoge'))
    expect(screen.getByTestId('valor')).toHaveTextContent('{"opcion":"recoge"}')
    expect(screen.getByTestId('entrega-corte')).toHaveTextContent(/Sucursal Renovacell, Culiacán · L–S/)
  })
  it('si el servidor falla, se explica y la elección queda vacía (el pedido no se crea sin entrega)', async () => {
    render(<Arnes cargar={async () => ({ ok: false, error: 'sin red' })} />)
    await waitFor(() => expect(screen.getByTestId('entrega-error')).toHaveTextContent(/sin red/))
    expect(screen.getByTestId('valor')).toHaveTextContent('null'); expect(screen.getByTestId('completa')).toHaveTextContent('false')
  })
})

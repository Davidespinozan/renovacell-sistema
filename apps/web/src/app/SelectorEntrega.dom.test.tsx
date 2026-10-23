// @vitest-environment jsdom
// ENT-2 · Selector de entrega del personal: opciones del servidor con flete y promesa; sugerida preseleccionada;
// cambiar el flete exige motivo; la elección que viaja es {opcion} o {opcion, flete, motivo}; nunca una fecha inventada.
import React, { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SelectorEntrega, eleccionCompleta } from './SelectorEntrega'
import type { EleccionEntregaServidor, HorariosDisponibles, OpcionesEntrega } from '../data/ops/entrega'

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

// ENT-H · horarios de entrega local del servidor (hoy 21 oct a las 14:00: la mañana ya pasó, 16:00 ocupado)
const DISP: HorariosDisponibles = {
  zona: 'America/Mazatlan', hoy: '2026-10-21', ahora: '14:00', salida: '2026-10-21', antes_de_corte: true, corte: '15:30', cupo: 1, intervalo_min: 30, margen_min: 60,
  franjas: [{ desde: '10:30', hasta: '13:30' }, { desde: '15:30', hasta: '17:30' }],
  dias: [{ fecha: '2026-10-21', dia_semana: 3, disponibles: 3, slots: [
    { inicio: '10:30', fin: '11:00', ocupados: 0, cupo: 1, disponible: false, motivo: 'PASADO' }, { inicio: '15:30', fin: '16:00', ocupados: 0, cupo: 1, disponible: true, motivo: null },
    { inicio: '16:00', fin: '16:30', ocupados: 1, cupo: 1, disponible: false, motivo: 'OCUPADO' }, { inicio: '16:30', fin: '17:00', ocupados: 0, cupo: 1, disponible: true, motivo: null }, { inicio: '17:00', fin: '17:30', ocupados: 0, cupo: 1, disponible: true, motivo: null },
  ] }],
}
const cargarHorarios = async () => ({ ok: true as const, data: DISP })

function Arnes({ cargar, subtotal = 1000, cp = '82000' as string | null }: { cargar: typeof import('../data/ops/entrega').opcionesEntrega; subtotal?: number; cp?: string | null }) {
  const [v, setV] = useState<EleccionEntregaServidor | null>(null)
  const [ops, setOps] = useState<OpcionesEntrega | null>(null)
  return (
    <div>
      <SelectorEntrega subtotal={subtotal} cp={cp} value={v} onChange={(e, o) => { setV(e); setOps(o) }} cargar={cargar} cargarHorarios={cargarHorarios} />
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
  it('ENT-H · la entrega local exige horario: sin él la elección NO está completa; al elegirlo viaja {opcion, horario}; cambiar de opción lo suelta', async () => {
    render(<Arnes cargar={async () => ({ ok: true, data: { ...OPS, cp: '80020', local: true, sugerida: 'local_chofer' } })} cp="80020" />)
    await waitFor(() => expect(screen.getByTestId('entrega-local_chofer').querySelector('input')).toBeChecked())
    expect(screen.getByTestId('valor')).toHaveTextContent('{"opcion":"local_chofer"}')
    expect(screen.getByTestId('completa')).toHaveTextContent('false')   // falta el horario
    expect(screen.getByTestId('entrega-horario')).toHaveTextContent(/elige uno para continuar/)
    await waitFor(() => expect(screen.getByTestId('horario-2026-10-21-15:30')).toBeInTheDocument())
    expect(screen.getByTestId('horario-2026-10-21-16:00')).toBeDisabled()   // ocupado por otro pedido
    fireEvent.click(screen.getByTestId('horario-2026-10-21-15:30'))
    expect(screen.getByTestId('valor')).toHaveTextContent('{"opcion":"local_chofer","horario":{"fecha":"2026-10-21","inicio":"15:30"}}')
    expect(screen.getByTestId('completa')).toHaveTextContent('true')
    expect(screen.getByTestId('entrega-local_chofer')).toHaveTextContent(/Llega hoy a las 15:30/)
    // el ajuste de flete conserva el horario
    fireEvent.click(screen.getByTestId('entrega-ajustar'))
    fireEvent.change(screen.getByTestId('entrega-flete'), { target: { value: '150' } })
    fireEvent.change(screen.getByTestId('entrega-motivo'), { target: { value: 'Zona lejana' } })
    expect(screen.getByTestId('valor')).toHaveTextContent('"horario":{"fecha":"2026-10-21","inicio":"15:30"}')
    expect(screen.getByTestId('completa')).toHaveTextContent('true')
    // cambiar a recoger: sin horario, completa
    fireEvent.click(screen.getByTestId('entrega-recoge'))
    expect(screen.getByTestId('valor')).toHaveTextContent('{"opcion":"recoge"}')
    expect(screen.queryByTestId('entrega-horario')).toBeNull()
    expect(screen.getByTestId('completa')).toHaveTextContent('true')
  })
  it('si el servidor falla, se explica y la elección queda vacía (el pedido no se crea sin entrega)', async () => {
    render(<Arnes cargar={async () => ({ ok: false, error: 'sin red' })} />)
    await waitFor(() => expect(screen.getByTestId('entrega-error')).toHaveTextContent(/sin red/))
    expect(screen.getByTestId('valor')).toHaveTextContent('null'); expect(screen.getByTestId('completa')).toHaveTextContent('false')
  })
})

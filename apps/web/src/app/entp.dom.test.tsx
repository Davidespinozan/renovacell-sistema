// @vitest-environment jsdom
// ENT-P · el vendedor ve el mismo aviso de envío gratis que el doctor ("al cliente le faltan"), y el chofer local abajo del
// mínimo solo continúa con motivo (cortesía). El doctor ve el aviso en su carrito con la zona de su dirección predeterminada.
import React, { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SelectorEntrega, eleccionCompleta } from './SelectorEntrega'
import { AvisoEnvioGratisVista, useAvisoEnvioGratis } from './AvisoEnvioGratis'
import type { EleccionEntregaServidor, HorariosDisponibles, OpcionesEntrega } from '../data/ops/entrega'
import { opsPara } from '../screens/checkout/entregaUx.fixtures'

vi.mock('../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn() }, currentUserId: () => 'u1' }))
beforeEach(cleanup)

const staff = (cp: string | null, subtotal: number): OpcionesEntrega => ({
  ...opsPara(cp, subtotal), actor: 'staff', sugerida: cp && cp < '80300' ? 'local_chofer' : 'foraneo_dhl',
  opciones: opsPara(cp, subtotal).opciones.map((o) => (o.tipo === 'mostrador' ? { ...o, permitido: true, motivo: null } : o.tipo === 'local' || o.tipo === 'foraneo' ? { ...o, permitido: true, motivo: null } : o)),
})
const DISP: HorariosDisponibles = {
  zona: 'America/Mazatlan', hoy: '2026-10-21', ahora: '09:00', salida: '2026-10-21', antes_de_corte: true, corte: '15:30', cupo: 1, intervalo_min: 30, margen_min: 60,
  franjas: [{ desde: '10:30', hasta: '13:30' }],
  dias: [{ fecha: '2026-10-21', dia_semana: 3, disponibles: 1, slots: [{ inicio: '10:30', fin: '11:00', ocupados: 0, cupo: 1, disponible: true, motivo: null }] }],
}
const cargarHorarios = async () => ({ ok: true as const, data: DISP })

function Arnes({ ops }: { ops: OpcionesEntrega }) {
  const [v, setV] = useState<EleccionEntregaServidor | null>(null)
  const [o, setO] = useState<OpcionesEntrega | null>(null)
  return (
    <div>
      <SelectorEntrega subtotal={ops.subtotal} cp={ops.cp} value={v} onChange={(e, x) => { setV(e); setO(x) }} cargar={async () => ({ ok: true as const, data: ops })} cargarHorarios={cargarHorarios} />
      <pre data-testid="valor">{JSON.stringify(v)}</pre>
      <span data-testid="completa">{String(eleccionCompleta(v, o))}</span>
    </div>
  )
}

describe('ENT-P · entrega del vendedor (Caja y Levantar pedido)', () => {
  it('foráneo: el vendedor ve cuánto le falta al cliente para el envío gratis', async () => {
    render(<Arnes ops={staff('82000', 3800)} />)
    await waitFor(() => expect(screen.getByTestId('entrega-aviso-envio')).toHaveTextContent('Al cliente le faltan $1,200 para el envío gratis'))
    expect(screen.queryByTestId('entrega-faltante-foraneo_dhl')).toBeNull()   // la elegida no repite la nota: la dice el aviso
    fireEvent.click(screen.getByTestId('entrega-recoge'))
    await waitFor(() => expect(screen.getByTestId('entrega-faltante-foraneo_dhl')).toHaveTextContent('Gratis desde $5,000 · al cliente le faltan $1,200'))
    fireEvent.click(screen.getByTestId('entrega-foraneo_dhl'))
    expect(screen.getByTestId('completa')).toHaveTextContent('true')   // DHL con $600 no exige nada más
  })
  it('chofer local abajo de $500: no continúa sin motivo; con motivo sí y el motivo viaja', async () => {
    render(<Arnes ops={staff('80020', 350)} />)
    await waitFor(() => expect(screen.getByTestId('entrega-bajo-minimo')).toBeInTheDocument())
    expect(screen.getByTestId('entrega-bajo-minimo')).toHaveTextContent('Al cliente le faltan $150 para la entrega gratis con chofer')
    expect(screen.queryByTestId('entrega-aviso-envio')).toBeNull()   // una sola explicación, no tres
    fireEvent.click(await screen.findByTestId('horario-2026-10-21-10:30'))
    await waitFor(() => expect(screen.getByTestId('valor')).toHaveTextContent('"horario"'))
    expect(screen.getByTestId('completa')).toHaveTextContent('false')
    fireEvent.change(screen.getByTestId('entrega-motivo-minimo'), { target: { value: 'ok' } })
    expect(screen.getByTestId('completa')).toHaveTextContent('false')
    fireEvent.change(screen.getByTestId('entrega-motivo-minimo'), { target: { value: 'Cortesía: cliente frecuente' } })
    await waitFor(() => expect(screen.getByTestId('completa')).toHaveTextContent('true'))
    const v = JSON.parse(screen.getByTestId('valor').textContent!)
    expect(v).toMatchObject({ opcion: 'local_chofer', motivo: 'Cortesía: cliente frecuente', horario: { fecha: '2026-10-21', inicio: '10:30' } })
  })
  it('desde $500 el chofer no pide motivo', async () => {
    render(<Arnes ops={staff('80020', 800)} />)
    await waitFor(() => expect(screen.getByTestId('entrega-aviso-envio')).toHaveTextContent('La entrega con chofer en Culiacán ya es gratis'))
    expect(screen.queryByTestId('entrega-bajo-minimo')).toBeNull()
  })
})

function ArnesDoctor({ subtotal, cp, cargar }: { subtotal: number | null; cp: string | null; cargar: (a: 'doctor' | 'staff', s: number, c: string | null) => Promise<{ ok: true; data: OpcionesEntrega }> }) {
  const aviso = useAvisoEnvioGratis(subtotal, { cargar, cpPredeterminado: async () => cp })
  return <AvisoEnvioGratisVista aviso={aviso} />
}

describe('ENT-P · carrito del doctor', () => {
  it('pide la regla al servidor con el CP de su dirección predeterminada y muestra el faltante', async () => {
    const cargar = vi.fn(async (_a: 'doctor' | 'staff', s: number, c: string | null) => ({ ok: true as const, data: opsPara(c, s) }))
    render(<ArnesDoctor subtotal={3800} cp="82000" cargar={cargar} />)
    await waitFor(() => expect(screen.getByTestId('aviso-envio-gratis')).toHaveTextContent('Te faltan $1,200 para el envío gratis'))
    expect(cargar).toHaveBeenCalledWith('doctor', 3800, '82000')
    expect(screen.getByTestId('aviso-envio-gratis')).toHaveTextContent('si no, el envío cuesta $600')
  })
  it('sin dirección menciona las dos zonas; carrito vacío no muestra nada', async () => {
    const cargar = vi.fn(async (_a: 'doctor' | 'staff', s: number, c: string | null) => ({ ok: true as const, data: opsPara(c, s) }))
    const { rerender } = render(<ArnesDoctor subtotal={350} cp={null} cargar={cargar} />)
    await waitFor(() => expect(screen.getByTestId('aviso-envio-gratis')).toHaveTextContent('En Culiacán, chofer gratis desde $500 (faltan $150)'))
    rerender(<ArnesDoctor subtotal={null} cp={null} cargar={cargar} />)
    await waitFor(() => expect(screen.queryByTestId('aviso-envio-gratis')).toBeNull())
  })
})

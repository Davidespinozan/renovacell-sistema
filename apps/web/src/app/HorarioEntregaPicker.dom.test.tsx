// @vitest-environment jsdom
// ENT-H · Selector de horario de entrega local: los días y horarios vienen del SERVIDOR (disponible / ocupado / ya pasó);
// el usuario elige uno libre; el elegido se puede soltar; lo ocupado y lo pasado no se pueden elegir; si al actualizar el
// horario elegido ya no está libre, se suelta (el pedido no se crea con un horario inventado).
import React, { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { HorarioEntregaPicker } from './HorarioEntregaPicker'
import type { HorarioElegido, HorariosDisponibles } from '../data/ops/entrega'

vi.mock('../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn() } }))
beforeEach(cleanup)

const slot = (inicio: string, fin: string, extra: Partial<HorariosDisponibles['dias'][number]['slots'][number]> = {}) => ({ inicio, fin, ocupados: 0, cupo: 1, disponible: true, motivo: null, ...extra })
export const DISP: HorariosDisponibles = {
  zona: 'America/Mazatlan', hoy: '2026-10-21', ahora: '14:00', salida: '2026-10-21', antes_de_corte: true, corte: '15:30', cupo: 1, intervalo_min: 30, margen_min: 60,
  franjas: [{ desde: '10:30', hasta: '13:30' }, { desde: '15:30', hasta: '17:30' }],
  dias: [
    { fecha: '2026-10-21', dia_semana: 3, disponibles: 3, slots: [
      slot('10:30', '11:00', { disponible: false, motivo: 'PASADO' }), slot('11:00', '11:30', { disponible: false, motivo: 'PASADO' }), slot('11:30', '12:00', { disponible: false, motivo: 'PASADO' }),
      slot('12:00', '12:30', { disponible: false, motivo: 'PASADO' }), slot('12:30', '13:00', { disponible: false, motivo: 'PASADO' }), slot('13:00', '13:30', { disponible: false, motivo: 'PASADO' }),
      slot('15:30', '16:00'), slot('16:00', '16:30', { disponible: false, ocupados: 1, motivo: 'OCUPADO' }), slot('16:30', '17:00'), slot('17:00', '17:30'),
    ] },
    { fecha: '2026-10-22', dia_semana: 4, disponibles: 10, slots: [slot('10:30', '11:00'), slot('11:00', '11:30'), slot('11:30', '12:00'), slot('12:00', '12:30'), slot('12:30', '13:00'), slot('13:00', '13:30'), slot('15:30', '16:00'), slot('16:00', '16:30'), slot('16:30', '17:00'), slot('17:00', '17:30')] },
  ],
}

function Arnes({ cargar, inicial = null }: { cargar: typeof import('../data/ops/entrega').horariosEntregaDisponibles; inicial?: HorarioElegido | null }) {
  const [v, setV] = useState<HorarioElegido | null>(inicial)
  return <div><HorarioEntregaPicker value={v} onChange={setV} cargar={cargar} /><pre data-testid="valor">{JSON.stringify(v)}</pre></div>
}

describe('ENT-H · HorarioEntregaPicker', () => {
  it('muestra los días del servidor, abre el primero con horarios libres y marca lo pasado y lo ocupado como no elegible', async () => {
    const cargar = vi.fn(async () => ({ ok: true as const, data: DISP }))
    render(<Arnes cargar={cargar} />)
    await waitFor(() => expect(screen.getByTestId('horario-picker')).toBeInTheDocument())
    expect(cargar).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('horario-dia-2026-10-21')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('horario-dia-2026-10-21')).toHaveTextContent(/hoy/); expect(screen.getByTestId('horario-dia-2026-10-21')).toHaveTextContent(/3 libres/)
    expect(screen.getByTestId('horario-dia-2026-10-22')).toHaveTextContent(/jue/)
    expect(screen.getAllByRole('radio')).toHaveLength(10)
    expect(screen.getByTestId('horario-2026-10-21-10:30')).toBeDisabled(); expect(screen.getByTestId('horario-2026-10-21-10:30')).toHaveTextContent(/ya pasó/)
    expect(screen.getByTestId('horario-2026-10-21-16:00')).toBeDisabled(); expect(screen.getByTestId('horario-2026-10-21-16:00')).toHaveTextContent(/ocupado/)
    expect(screen.getByTestId('horario-2026-10-21-15:30')).not.toBeDisabled(); expect(screen.getByTestId('horario-2026-10-21-15:30')).toHaveTextContent(/15:30–16:00/)
    expect(screen.getByTestId('valor')).toHaveTextContent('null')
  })
  it('elegir un horario libre reporta {fecha, inicio}; volver a tocarlo lo suelta; cambiar de día muestra sus horarios', async () => {
    render(<Arnes cargar={async () => ({ ok: true, data: DISP })} />)
    await waitFor(() => expect(screen.getByTestId('horario-2026-10-21-15:30')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('horario-2026-10-21-15:30'))
    expect(screen.getByTestId('valor')).toHaveTextContent('{"fecha":"2026-10-21","inicio":"15:30"}')
    expect(screen.getByTestId('horario-2026-10-21-15:30')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('horario-pie')).toHaveTextContent(/Entrega hoy entre 15:30 y 16:00/)
    fireEvent.click(screen.getByTestId('horario-2026-10-21-16:00'))   // ocupado: no cambia nada
    expect(screen.getByTestId('valor')).toHaveTextContent('{"fecha":"2026-10-21","inicio":"15:30"}')
    fireEvent.click(screen.getByTestId('horario-dia-2026-10-22'))
    expect(screen.getByTestId('horario-2026-10-22-10:30')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('horario-2026-10-22-10:30'))
    expect(screen.getByTestId('valor')).toHaveTextContent('{"fecha":"2026-10-22","inicio":"10:30"}')
    expect(screen.getByTestId('horario-pie')).toHaveTextContent(/jueves 22 oct entre 10:30 y 11:00/)
    fireEvent.click(screen.getByTestId('horario-2026-10-22-10:30'))
    expect(screen.getByTestId('valor')).toHaveTextContent('null')
  })
  it('si al actualizar el horario elegido ya está ocupado, se suelta (no se pide con un horario que ya no existe)', async () => {
    let n = 0
    const cargar = vi.fn(async () => {
      n += 1
      if (n === 1) return { ok: true as const, data: DISP }
      const dias = DISP.dias.map((d) => d.fecha !== '2026-10-21' ? d : { ...d, disponibles: 2, slots: d.slots.map((s) => s.inicio === '15:30' ? { ...s, disponible: false, ocupados: 1, motivo: 'OCUPADO' as const } : s) })
      return { ok: true as const, data: { ...DISP, dias } }
    })
    render(<Arnes cargar={cargar} inicial={{ fecha: '2026-10-21', inicio: '15:30' }} />)
    await waitFor(() => expect(screen.getByTestId('horario-2026-10-21-15:30')).toHaveAttribute('aria-checked', 'true'))
    fireEvent.click(screen.getByTestId('horario-actualizar'))
    await waitFor(() => expect(screen.getByTestId('valor')).toHaveTextContent('null'))
    expect(screen.getByTestId('horario-2026-10-21-15:30')).toBeDisabled()
  })
  it('el horario a excluir (al reprogramar: el actual) no se puede elegir aunque esté libre', async () => {
    const Ex = () => { const [v, setV] = useState<HorarioElegido | null>(null); return <HorarioEntregaPicker value={v} onChange={setV} cargar={async () => ({ ok: true, data: DISP })} excluir={{ fecha: '2026-10-21', inicio: '16:30' }} /> }
    render(<Ex />)
    await waitFor(() => expect(screen.getByTestId('horario-2026-10-21-16:30')).toBeDisabled())
    expect(screen.getByTestId('horario-2026-10-21-16:30')).toHaveTextContent(/actual/)
  })
  it('si el servidor falla, lo dice', async () => {
    render(<Arnes cargar={async () => ({ ok: false, error: 'sin red' })} />)
    await waitFor(() => expect(screen.getByTestId('horario-error')).toHaveTextContent(/sin red/))
  })
})

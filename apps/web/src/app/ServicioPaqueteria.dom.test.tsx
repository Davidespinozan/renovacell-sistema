// @vitest-environment jsdom
// ENTREGA-SERVICIO · el cliente o su vendedor eligen el servicio con su fecha exacta: se propone el más barato, el rápido
// muestra lo que cuesta de más, y si la paquetería no responde se vende con la regla (sin servicio).
import React, { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ServicioPaqueteria } from './ServicioPaqueteria'
import type { CotizacionEnvio, ServicioElegido } from '../data/ops/entrega'

vi.mock('../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn() } }))
beforeEach(cleanup)

const COT: CotizacionEnvio = { cotizacion_id: 'cot-1', expira_at: new Date(Date.now() + 7_200_000).toISOString(), proveedor: 'dhl', servicios: [
  { codigo: 'N', nombre: 'EXPRESS DOMESTIC', costo: 330.62, diferencia: 0, llega_fecha: '2026-11-05', llega_at: '2026-11-05T23:59:00' },
  { codigo: '1', nombre: 'EXPRESS DOMESTIC 12:00', costo: 421.68, diferencia: 92, llega_fecha: '2026-11-05', llega_at: '2026-11-05T12:00:00' },
] }

function Caja({ cargar, onValor }: { cargar: React.ComponentProps<typeof ServicioPaqueteria>['cargar']; onValor: (v: ServicioElegido | null) => void }) {
  const [v, setV] = useState<ServicioElegido | null>(null)
  return <ServicioPaqueteria cp="44100" piezas={2} fleteRegla={600} value={v} onChange={(s) => { setV(s); onValor(s) }} cargar={cargar} />
}

describe('ServicioPaqueteria', () => {
  it('propone el más barato y el rápido cobra solo la diferencia', async () => {
    const cargar = vi.fn(async () => ({ ok: true as const, data: COT }))
    const valores: Array<ServicioElegido | null> = []
    render(<Caja cargar={cargar} onValor={(x) => valores.push(x)} />)
    await waitFor(() => expect(screen.getByTestId('servicio-paqueteria')).toBeTruthy())
    expect(cargar).toHaveBeenCalledWith('44100', 2, undefined)
    expect(valores.at(-1)).toEqual({ cotizacion_id: 'cot-1', codigo: 'N', diferencia: 0 })
    expect(screen.getByTestId('servicio-N').textContent).toContain('$600')
    expect(screen.getByTestId('servicio-1').textContent).toMatch(/antes de las 12:00/)
    expect(screen.getByTestId('servicio-1').textContent).toContain('$692')
    fireEvent.click(screen.getByTestId('servicio-1').querySelector('input')!)
    expect(valores.at(-1)).toEqual({ cotizacion_id: 'cot-1', codigo: '1', diferencia: 92 })
  })
  it('si la paquetería no responde: se avisa y se vende con la regla (sin servicio)', async () => {
    const valores: Array<ServicioElegido | null> = []
    render(<Caja cargar={async () => ({ ok: false as const, error: 'DHL tardó demasiado: se usa la regla de entrega.' })} onValor={(x) => valores.push(x)} />)
    await waitFor(() => expect(screen.getByTestId('servicio-sin-cotizacion').textContent).toMatch(/regla de entrega/))
    expect(valores.at(-1)).toBeNull()
  })
})

// @vitest-environment jsdom
// EMBUDO · próximo paso con fecha y oportunidades quietas (15 nov 2026)
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Embudo } from './Embudo'
import type { Oportunidad } from '../../data/ops/crm'
import sql from '../../../../../supabase/migrations/20270407210000_crm_proximo_paso.sql?raw'

const op = (x: Partial<Oportunidad>): Oportunidad => ({ id: 'o1', etapa: 'nuevo', titulo: 'Hola', monto: null, origen: 'whatsapp', customer_id: 'c1', conversation_id: null, cliente: 'ADRIANA URETA',
  vendedor_id: 'v1', vendedor: null, cotizacion_id: null, order_id: null, folio_pedido: null, motivo_perdida: null, etapa_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z',
  cerrada_at: null, dias_en_etapa: 14, proximo_paso: null, proximo_at: null, quieta: true, paso_hoy: false, ...x })
const cliente = (ops: Oportunidad[]) => ({
  embudo: vi.fn().mockResolvedValue({ ok: true, data: ops }), resumen: vi.fn().mockResolvedValue({ ok: false, error: 'NO_AUTORIZADO' }),
  paso: vi.fn().mockImplementation(async (id: string, texto: string | null, fecha: string | null) => ({ ok: true, data: op({ id, proximo_paso: texto, proximo_at: fecha, quieta: false }) })),
  editar: vi.fn().mockImplementation(async (id: string, c: { monto: number }) => ({ ok: true, data: op({ id, monto: c.monto, quieta: false }) })),
  mover: vi.fn(), crear: vi.fn(),
})

describe('Embudo · próximo paso', () => {
  it('marca las quietas, filtra y guarda paso con día y monto', async () => {
    const c = cliente([op({}), op({ id: 'o2', cliente: 'BEATRIZ RUIZ', quieta: false, paso_hoy: true, proximo_paso: 'Llamarle para cerrar', proximo_at: '2026-11-16' }), op({ id: 'o3', cliente: 'CARLOS', quieta: false })])
    render(<Embudo cliente={c as never} />)
    expect(await screen.findByTestId('crm-quietas')).toHaveTextContent('1 toca hoy · 1 quieta')
    expect(screen.getAllByTestId('crm-paso')[0]).toHaveTextContent('Quieta 14 días. ¿Qué sigue?')
    expect(screen.getByText(/Llamarle para cerrar/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('crm-quietas'))
    expect(screen.queryByText('CARLOS')).toBeNull()
    fireEvent.click(screen.getAllByTestId('crm-paso')[0])
    const hoja = await screen.findByTestId('crm-hoja-paso')
    fireEvent.change(within(hoja).getByTestId('crm-paso-texto'), { target: { value: 'Mandar cotización' } })
    fireEvent.click(within(hoja).getByText('En 3 días'))
    fireEvent.change(within(hoja).getByTestId('crm-paso-monto'), { target: { value: '$4,500' } })
    fireEvent.click(within(hoja).getByTestId('crm-paso-guardar'))
    await waitFor(() => expect(c.paso).toHaveBeenCalledWith('o1', 'Mandar cotización', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)))
    await waitFor(() => expect(c.editar).toHaveBeenCalledWith('o1', { monto: 4500 }))
  })
  it('la base: quieta = paso vencido o 5 días sin paso; aviso L–S a las 9 de Mazatlán', () => {
    expect(sql).toMatch(/o\.proximo_at < public\.hoy_local\(\)\)\s+or \(o\.proximo_at is null and now\(\) - o\.etapa_at >= interval '5 days'\)/)
    expect(sql).toMatch(/cron\.schedule\('renovacell-crm-quietas', '0 16 \* \* 1-6'/)
    expect(sql).toMatch(/if not public\._crm_puede\(p_id\)/)
  })
})

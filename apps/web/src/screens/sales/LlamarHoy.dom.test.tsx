// @vitest-environment jsdom
// PROSPECCIÓN · «A quién llamar hoy» (15 nov 2026)
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LlamarHoy } from './LlamarHoy'
import { telMarcable, type ListaHoy } from '../../data/ops/prospeccion'
import sql from '../../../../../supabase/migrations/20270407190000_prospeccion_llamadas.sql?raw'

const lista: ListaHoy = {
  vendedor: 'v1', por_llamar: 534,
  resumen: { hechas_hoy: 2, interesados_hoy: 1, hechas_semana: 9, interesados_semana: 3 },
  lista: [
    { customer_id: 'c1', nombre: 'AARON DIAZ', telefono: '6677756260', ciudad: 'Culiacan', tipo: null, especialidad: 'Dermatología', intentos: 0, ultimo: null, ultimo_at: null, ultima_nota: null, motivo: 'Nunca se le ha llamado' },
    { customer_id: 'c2', nombre: 'BEATRIZ RUIZ', telefono: '6671112233', ciudad: null, tipo: null, especialidad: null, intentos: 1, ultimo: 'llamar_despues', ultimo_at: '2026-11-13T18:00:00Z', ultima_nota: 'después de las 5', motivo: 'Quedaste de llamarle hoy' },
  ],
}
const cliente = (sobre: Record<string, unknown> = {}) => ({
  hoy: vi.fn().mockResolvedValue({ ok: true, data: lista }),
  resumen: vi.fn().mockResolvedValue({ ok: false, error: 'NO_AUTORIZADO' }),
  registrar: vi.fn().mockResolvedValue({ ok: true, data: { id: 'x', resultado: 'interesado', oportunidad: {} } }),
  ...sobre,
}) as never

describe('A quién llamar hoy', () => {
  it('muestra la lista, el avance del día y el botón para marcar', async () => {
    render(<LlamarHoy cliente={cliente()} />)
    expect(await screen.findByText('AARON DIAZ')).toBeTruthy()
    expect(screen.getByText('534')).toBeTruthy()
    expect(screen.getByText(/Quedaste de llamarle hoy/)).toBeTruthy()
    expect(screen.getAllByTestId('llamar-tel')[0].getAttribute('href')).toBe('tel:+526677756260')
    expect(screen.queryByTestId('llamar-avance')).toBeNull()   // la vendedora no ve el avance del equipo
  })
  it('anota el resultado; "llamar otro día" pide la fecha', async () => {
    const c = cliente()
    render(<LlamarHoy cliente={c} />)
    fireEvent.click((await screen.findAllByTestId('llamar-fila'))[0])
    const hoja = await screen.findByTestId('llamar-hoja')
    expect((within(hoja).getByTestId('llamar-guardar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(hoja).getByTestId('res-llamar_despues'))
    expect(within(hoja).getByTestId('llamar-fecha')).toBeTruthy()
    fireEvent.click(within(hoja).getByTestId('res-interesado'))
    fireEvent.change(within(hoja).getByTestId('llamar-nota'), { target: { value: 'quiere Golden' } })
    fireEvent.click(within(hoja).getByTestId('llamar-guardar'))
    await waitFor(() => expect((c as unknown as { registrar: ReturnType<typeof vi.fn> }).registrar).toHaveBeenCalledWith('c1', 'interesado', 'quiere Golden', null))
  })
  it('Dirección ve el avance de cada vendedora', async () => {
    render(<LlamarHoy cliente={cliente({ resumen: vi.fn().mockResolvedValue({ ok: true, data: [{ vendedor_id: 'v1', vendedor: 'Alejandra', hoy: 3, periodo: 10, interesados: 2, cartera: 600 }] }) })} />)
    expect(await screen.findByText('Alejandra')).toBeTruthy()
  })
  it('teléfonos: 10 dígitos llevan +52', () => {
    expect(telMarcable('667 775 6260')).toBe('+526677756260')
    expect(telMarcable('526677756260')).toBe('+526677756260')
  })
  it('la base: solo su cartera, interesado entra al embudo, llamar otro día deja pendiente', () => {
    expect(sql).toMatch(/_dif_es_mio\(p_customer, a\.todos, a\.uid\)/)
    expect(sql).toMatch(/crm_crear\(p_customer/)
    expect(sql).toMatch(/seguimiento_guardar\(p_customer, null, 'quedo_de_llamar'/)
    expect(sql).toMatch(/revoke all on table public\.prospeccion_llamadas from public, anon, authenticated/)
  })
})

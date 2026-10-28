// @vitest-environment jsdom
// INVITA-1 · pantalla Invitar clientes: vista previa de la audiencia con omitidos, lanzar con confirmación, seguir la
// campaña (avance, cuentas creadas, nota de pausa) y pausar / ver la lista para revisar. Servidor FALSO.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { InvitarClientes } from './InvitarClientes'
import { ClienteInvitacionesMasivas, type Campana } from '../../data/ops/invitacionesMasivas'

afterEach(cleanup)
const HOR = { configurado: true, abierto: true, zona: 'America/Mazatlan', motivo: 'en_horario' }
const camp = (o: Partial<Campana>): Campana => ({ id: 'c1', canal: 'correo', estado: 'activa', nota: null, limite_diario: 150, plantilla_wa: null, creada_at: '2026-10-28T16:00:00Z', sin_vendedor: false, vendedor: null,
  pendientes: 900, enviados: 232, inciertos: 0, fallidos: 2, omitidos: 119, cancelados: 0, hoy: 82, cuentas: 14, ...o })

function servidor(campanas: Campana[] = []) {
  const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    llamadas.push({ fn, args })
    if (fn === 'invitaciones_masivas_estado') return { data: { horario: HOR, campanas }, error: null }
    if (fn === 'invitaciones_masivas_previa') return { data: { canal: args?.p_canal, elegibles: args?.p_canal === 'correo' ? 1000 : 1400, omitidos: { correo_repetido: 119, sin_correo: 1036 }, total: 2155 }, error: null }
    if (fn === 'invitaciones_masivas_crear') return { data: { campana_id: 'nueva', pendientes: 1000, omitidos: 119 }, error: null }
    if (fn === 'invitaciones_masivas_cambiar') return { data: { estado: 'pausada' }, error: null }
    if (fn === 'invitaciones_masivas_revisar') return { data: [{ customer_id: 'k', nombre: 'Dup Uno', destino: 'dup@x.mx', estado: 'omitido', motivo: 'correo_repetido' }], error: null }
    return { data: null, error: { message: 'desconocido' } }
  }
  return { cliente: new ClienteInvitacionesMasivas(rpc), llamadas }
}
const vendedores = async () => ({ ok: true as const, data: [{ id: 's1', nombre: 'Roberto Ibarra', activo: true, conversaciones: true, nuevos_clientes: true, elegible: true, elegible_nuevos: true, clientes: 0 }] })

describe('INVITA-1 · Invitar clientes', () => {
  it('muestra a cuántos les llega, los omitidos y los días; lanza con confirmación', async () => {
    const s = servidor()
    render(<InvitarClientes cliente={s.cliente} vendedoresDe={vendedores} />)
    const previa = await screen.findByTestId('inv-previa')
    await waitFor(() => expect(previa.textContent).toMatch(/Le llega a 1,000/))
    expect(previa.textContent).toMatch(/Correo repetido en otro cliente: 119/)
    expect(previa.textContent).toMatch(/13 día/)
    fireEvent.change(await screen.findByTestId('inv-audiencia'), { target: { value: 's1' } })
    await waitFor(() => expect(s.llamadas.some((l) => l.fn === 'invitaciones_masivas_previa' && l.args?.p_seller === 's1')).toBe(true))
    fireEvent.click(await screen.findByTestId('inv-lanzar'))
    fireEvent.click(within(document.querySelector('.overlay') as HTMLElement).getByRole('button', { name: 'Empezar envío' }))
    await waitFor(() => expect(s.llamadas.find((l) => l.fn === 'invitaciones_masivas_crear')?.args).toEqual({ p_canal: 'correo', p_seller: 's1', p_sin_vendedor: false, p_limite_diario: 80, p_plantilla: null, p_idioma: 'es_MX' }))
    expect(await screen.findByText(/1000 invitaciones en cola/)).toBeTruthy()
  })

  it('WhatsApp pide la plantilla y muestra el texto para Meta', async () => {
    const s = servidor()
    render(<InvitarClientes cliente={s.cliente} vendedoresDe={vendedores} />)
    fireEvent.click(await screen.findByTestId('inv-canal-whatsapp'))
    expect(await screen.findByText(/plantilla aprobada por Meta/)).toBeTruthy()
    expect(screen.getByLabelText('Plantilla')).toHaveProperty('value', 'invitacion_cuenta')
  })

  it('campaña en curso: avance, cuentas creadas, pausa y lista para revisar; bloquea otra del mismo canal', async () => {
    const s = servidor([camp({})])
    render(<InvitarClientes cliente={s.cliente} vendedoresDe={vendedores} />)
    const t = await screen.findByTestId('inv-campana')
    expect(t.textContent).toMatch(/232 enviadas/)
    expect(t.textContent).toMatch(/14 cuentas creadas/)
    expect(t.textContent).toMatch(/hoy 82\/150/)
    expect((await screen.findByTestId('inv-lanzar')).textContent).toMatch(/Ya hay una campaña de Correo en curso/)
    fireEvent.click(within(t).getByTestId('inv-revisar'))
    expect(await within(t).findByText('Dup Uno')).toBeTruthy()
    fireEvent.click(within(t).getByRole('button', { name: /Pausar/ }))
    await waitFor(() => expect(s.llamadas.some((l) => l.fn === 'invitaciones_masivas_cambiar' && l.args?.p_accion === 'pausar')).toBe(true))
  })

  it('pausada por el canal: se ve el motivo y se puede reanudar', async () => {
    const s = servidor([camp({ canal: 'whatsapp', estado: 'pausada', nota: 'Meta 400 (132001): Template name does not exist' })])
    render(<InvitarClientes cliente={s.cliente} vendedoresDe={vendedores} />)
    expect((await screen.findByTestId('inv-nota')).textContent).toMatch(/132001/)
    expect(screen.getByRole('button', { name: /Reanudar/ })).toBeTruthy()
  })
})

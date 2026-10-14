// @vitest-environment jsdom
// CARTERA-CLIENTES · desde la ficha, Dirección asigna vendedor a CUALQUIER cliente (con o sin cuenta), lo cambia o lo
// quita con motivo, y da de baja o reactiva al cliente. Todo por comandos del servidor (RPC inyectado, sin red).
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { Customer360Page } from './Customer360'
import { ClienteC360, type Cliente360 } from '../data/ops/customer360'
import { ClienteAtencion } from '../data/ops/atencion'

afterEach(cleanup)
const ficha = (x: Partial<Cliente360> = {}, resumen: Partial<Cliente360['resumen']> = {}): Cliente360 => ({
  customer_id: 'C1', rol: 'direccion',
  permisos: { contacto: ['full_name', 'email', 'city', 'country'], telefonos: true, domicilios: true, fiscal: true, notas: true, cartera: true, adoptar_alta: true, estado: true },
  resumen: { nombre: 'Clínica Sin Cuenta', activo: true, creado_at: null, origen: 'odoo', portal: { tiene: false, verificado: false, activo: false }, vendedor: null, vendedor_historico: 'Vendedor Odoo', ...resumen },
  contacto: { email: null, ciudad: null, pais: null, telefonos: [], alta: null, notas: [] },
  domicilios: { lista: [], archivados: 0, alta: null }, facturacion: [],
  comercial: { historial: [], atribucion: { origen: 'odoo', referido: null, prospecto: null }, conversacion: null, carrito: null },
  pedidos: [], resumen_pedidos: { n: 0, total: 0, ultimo: null }, pagos: [], facturas: [], actividad: [],
  ...x,
} as Cliente360)
const VEND = [{ id: 'V1', nombre: 'Lucía', activo: true, conversaciones: true, nuevos_clientes: true, elegible: true, elegible_nuevos: true, clientes: 3 },
              { id: 'V2', nombre: 'Alejandra', activo: true, conversaciones: false, nuevos_clientes: false, elegible: false, elegible_nuevos: false, clientes: 0 }]
function montar(d: Cliente360, vendedores = VEND) {
  const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const c = new ClienteC360(async (fn, args) => { llamadas.push({ fn, args }); return { data: fn === 'cliente_360' ? d : { idempotente: false }, error: null } })
  const at = new ClienteAtencion(async () => ({ data: vendedores, error: null }) as never)
  render(<Customer360Page customerId="C1" onBack={() => {}} cliente={c} atencion={at} />)
  return llamadas
}

describe('Vendedor y estado desde la ficha (Dirección)', () => {
  it('cliente SIN cuenta: se le asigna vendedor (solo aparecen los que pueden recibir clientes)', async () => {
    const llamadas = montar(ficha())
    await screen.findByText('Clínica Sin Cuenta')
    fireEvent.click(screen.getByTestId('tab-comercial'))
    const select = await screen.findByLabelText('Vendedor') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Asignar a…', 'Lucía'])   // Alejandra no es elegible
    expect(screen.queryByText(/no tiene cuenta de portal/)).toBeNull()
    fireEvent.change(select, { target: { value: 'V1' } })
    fireEvent.click(screen.getByTestId('btn-asignar-vendedor'))
    await waitFor(() => expect(llamadas.some((l) => l.fn === 'cliente_vendedor_asignar')).toBe(true))
    expect(llamadas.find((l) => l.fn === 'cliente_vendedor_asignar')!.args).toEqual({ p_customer: 'C1', p_vendedor: 'V1', p_motivo: null })
  })
  it('con vendedor: cambiar o quitar exige motivo', async () => {
    const llamadas = montar(ficha({}, { vendedor: { id: 'V9', nombre: 'Antes', desde: '2026-10-01', elegible: true } }))
    await screen.findByText('Clínica Sin Cuenta'); fireEvent.click(screen.getByTestId('tab-comercial'))
    fireEvent.change(await screen.findByLabelText('Vendedor'), { target: { value: 'V1' } })
    expect((screen.getByTestId('btn-asignar-vendedor') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('btn-quitar-vendedor') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Motivo del cambio de vendedor'), { target: { value: 'Cambio de zona' } })
    fireEvent.click(screen.getByTestId('btn-quitar-vendedor'))
    await waitFor(() => expect(llamadas.find((l) => l.fn === 'cliente_vendedor_asignar')?.args).toEqual({ p_customer: 'C1', p_vendedor: null, p_motivo: 'Cambio de zona' }))
  })
  it('sin vendedores que puedan recibir clientes: explica qué activar en Equipo', async () => {
    montar(ficha(), [VEND[1]])
    await screen.findByText('Clínica Sin Cuenta'); fireEvent.click(screen.getByTestId('tab-comercial'))
    expect((await screen.findByTestId('sin-vendedores')).textContent).toMatch(/Equipo/)
  })
  it('dar de baja exige motivo; un cliente dado de baja se reactiva y no ofrece levantar pedido', async () => {
    const llamadas = montar(ficha())
    await screen.findByText('Clínica Sin Cuenta')
    fireEvent.click(screen.getByTestId('btn-dar-baja'))
    expect((screen.getByTestId('btn-confirmar-baja') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Motivo de la baja'), { target: { value: 'Cerró su consultorio' } })
    fireEvent.click(screen.getByTestId('btn-confirmar-baja'))
    await waitFor(() => expect(llamadas.find((l) => l.fn === 'cliente_estado_guardar')?.args).toEqual({ p_customer: 'C1', p_activo: false, p_motivo: 'Cerró su consultorio' }))
    cleanup()
    const ll2 = montar(ficha({}, { activo: false }))
    await screen.findByText('Clínica Sin Cuenta')
    expect(screen.queryByText('Levantar pedido')).toBeNull()
    fireEvent.click(screen.getByTestId('btn-reactivar'))
    await waitFor(() => expect(ll2.find((l) => l.fn === 'cliente_estado_guardar')?.args).toEqual({ p_customer: 'C1', p_activo: true, p_motivo: null }))
  })
  it('sin permiso del servidor (vendedor) no aparecen asignar ni dar de baja', async () => {
    montar(ficha({ rol: 'vendedor', permisos: { contacto: ['email'], telefonos: true, domicilios: true, fiscal: false, notas: true, cartera: false, adoptar_alta: false, estado: false } }))
    await screen.findByText('Clínica Sin Cuenta')
    expect(screen.queryByTestId('btn-dar-baja')).toBeNull()
    fireEvent.click(screen.getByTestId('tab-comercial'))
    expect(screen.queryByTestId('cartera-asignar')).toBeNull()
  })
})

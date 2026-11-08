// @vitest-environment jsdom
// CALIDAD VISUAL · ronda 4 (7–8 nov 2026): Embudo por etapas en celular, Cartera y horario sin pestañas dentro de
// pestañas ni error repetido, ficha del cliente con estado del pedido en español, pies fijos y domicilio compacto.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
vi.mock('../auth/RoleContext', () => ({ useRole: () => ({ role: 'admin', user: { name: 'D' } }), useRoleOpcional: () => null }))
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { Embudo } from '../screens/sales/Embudo'
import { crm, type Oportunidad } from '../data/ops/crm'
import { AtencionComercial } from '../screens/admin/AtencionComercial'
import { ClienteAtencion } from '../data/ops/atencion'
import { Customer360Page } from './Customer360'
import { ClienteC360, type Cliente360 } from '../data/ops/customer360'
import { LocationForm, EMPTY_LOCATION } from './LocationForm'
import fuenteCheckout from '../screens/checkout/CheckoutCanonico.tsx?raw'
import fuentePedido from '../screens/sales/NuevoPedido.tsx?raw'
import fuenteCotizacion from '../screens/sales/NuevaCotizacion.tsx?raw'

afterEach(cleanup)

const op = (id: string, etapa: Oportunidad['etapa'], monto = 1000): Oportunidad => ({
  id, etapa, titulo: null, monto, origen: 'whatsapp', customer_id: null, conversation_id: null, cliente: `Cliente ${id}`, vendedor_id: null, vendedor: null,
  cotizacion_id: null, order_id: null, folio_pedido: null, motivo_perdida: null, etapa_at: 'T', created_at: 'T', cerrada_at: null, dias_en_etapa: 1,
})

describe('Embudo · una etapa a la vez en celular', () => {
  it('pestañas por etapa con su conteo; la elegida marca su columna como activa', async () => {
    const datos = [op('1', 'nuevo'), op('2', 'nuevo'), op('3', 'propuesta')]
    const cliente = crm(async (fn) => ({ data: fn === 'crm_embudo' ? datos : null, error: fn === 'crm_embudo' ? null : { message: 'x' } }))
    render(<Embudo cliente={cliente} />)
    const tabs = await screen.findByTestId('crm-tabs')
    expect(tabs.textContent).toContain('Nuevo2')
    expect(tabs.textContent).toContain('Propuesta1')
    expect(screen.getByTestId('crm-col-nuevo').className).toContain('activa')
    fireEvent.click(screen.getByRole('tab', { name: /Propuesta/ }))
    expect(screen.getByTestId('crm-col-propuesta').className).toContain('activa')
    expect(screen.getByTestId('crm-col-nuevo').className).not.toContain('activa')
    expect(screen.getByTestId('crm-col-ganado').textContent).toContain('Sin oportunidades')
  })
})

describe('Equipo → Cartera y horario', () => {
  const sinServidor = new ClienteAtencion(async () => ({ data: null, error: { message: 'Sin conexión con el servidor.' } }))
  it('secciones subrayadas (no otra barra de botones) y el error de conexión una sola vez', async () => {
    render(<AtencionComercial cliente={sinServidor} pestanas={['cartera', 'vendedores', 'horario']} titulo="Equipo" />)
    await waitFor(() => expect(screen.getByTestId('estado-horario').textContent).toBe('No se pudo leer el horario.'))
    expect(screen.getByRole('tablist', { name: /Secciones/ }).className).toBe('subtabs')
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(1))   // solo el aviso de la propia sección
  })
  it('mientras carga no afirma «sin configurar»', () => {
    const lento = new ClienteAtencion(() => new Promise(() => {}))
    render(<AtencionComercial cliente={lento} pestanas={['cartera', 'vendedores', 'horario']} />)
    expect(screen.getByTestId('estado-horario').textContent).toBe('Consultando horario…')
  })
})

describe('Ficha del cliente', () => {
  it('estado del pedido en español con su color; tablas como lista en celular', async () => {
    const ficha = {
      customer_id: 'C1', rol: 'direccion',
      permisos: { contacto: [], telefonos: false, domicilios: false, fiscal: false, notas: false, cartera: false, adoptar_alta: false },
      resumen: { nombre: 'Dra. Ruiz', activo: true, creado_at: null, origen: 'portal', portal: { tiene: true, verificado: true, activo: true }, vendedor: null, vendedor_historico: null },
      contacto: { email: null, ciudad: null, pais: null, telefonos: [], alta: null, notas: [] }, domicilios: { lista: [], archivados: 0, alta: null }, facturacion: [],
      comercial: { historial: [], atribucion: { origen: null, referido: null, prospecto: null }, conversacion: null, carrito: null },
      pedidos: [{ id: 'o1', folio: 'S1', fecha: '2026-11-04T17:00:00Z', estado: 'delivered', total: 500, estado_pago: 'pagado', saldo: 0, factura_solicitada: false }],
      resumen_pedidos: { n: 1, total: 500, ultimo: null }, pagos: [], facturas: [], actividad: [],
    } as unknown as Cliente360
    const c = new ClienteC360(async (fn) => ({ data: fn === 'cliente_360' ? ficha : null, error: null }) as never)
    render(<Customer360Page customerId="C1" onBack={() => {}} cliente={c} atencion={new ClienteAtencion(async () => ({ data: [], error: null }) as never)} />)
    await screen.findByText('Dra. Ruiz')
    fireEvent.click(screen.getByTestId('tab-pedidos'))
    const pill = screen.getByText('Entregado')
    expect(pill.className).toContain('p-ok')
    expect(screen.queryByText('delivered')).toBeNull()
    expect(document.querySelector('table.tbl-cards td[data-rol="valor"]')?.textContent).toContain('500')
  })
})

describe('Pies fijos y domicilio compacto', () => {
  it('total y acción principal en una barra fija en checkout, pedido y cotización', () => {
    for (const f of [fuenteCheckout, fuentePedido, fuenteCotizacion]) expect(f).toMatch(/barra-accion/)
  })
  it('núm. ext/int, C.P./ciudad y estado/país siguen en pares en celular', () => {
    render(<LocationForm value={EMPTY_LOCATION} onChange={() => {}} />)
    expect(document.querySelectorAll('.par-corto').length).toBe(3)
  })
})

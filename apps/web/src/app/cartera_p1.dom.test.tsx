// @vitest-environment jsdom
// CARTERA-P1 · Clientes (Ventas): "Mi cartera" = asignación VIGENTE del servidor (por id, aunque seller_name sea
// null), "Cartera histórica (Odoo)" = vista SEPARADA por equivalencia explícita (no son asignados), "Todos" sin
// regresiones; nunca por nombre (homónimos o nombres parecidos no dan pertenencia). Clientes falsos.
// SEC-C4-B4 · Ventas ya NO recibe el directorio: "Mi cartera" sale solo de cc_mi_cartera (nombre incluido), la
// cartera histórica (Odoo) queda oculta para Ventas y la exportación es solo de Dirección.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { CustomerDirectory } from './CustomerDirectory'
import { ClienteCartera } from '../data/ops/cartera'
import type { Customer } from '../data/ops/customer'

const h = vi.hoisted(() => ({ role: 'pos', name: 'Lucía · Ventas', customers: [] as unknown[], columnas: [] as Array<{ key: string; label: string; format?: (v: unknown, r: unknown) => unknown }> }))
vi.mock('../auth/RoleContext', () => ({ useRole: () => ({ role: h.role, user: { name: h.name, email: 'x@y' }, setScreen: vi.fn() }) }))
vi.mock('../data/hooks/useCustomers', async (orig) => {
  const m = await orig<typeof import('../data/hooks/useCustomers')>()
  return { ...m, useCustomers: () => ({ data: h.customers, loading: false, error: null, reload: vi.fn() }) }
})
vi.mock('./ExportButton', () => ({ ExportButton: ({ columns }: { columns: typeof h.columnas }) => { h.columnas = columns; return null } }))

const mk = (o: Partial<Customer>): Customer => ({ id: 'x', full_name: 'X', email: null, phone: null, city: null, country: null, seller_name: null, external_id: null, source: null, import_hash: null, profile_id: null, meta: {}, active: true, created_at: 'T', updated_at: 'T', ...o })
const DAVID = mk({ id: 'CU-DAVID', full_name: 'david espinoza', profile_id: 'P-DAVID', seller_name: null, source: 'portal' })
const H1 = mk({ id: 'CU-H1', full_name: 'Hist Uno', seller_name: 'Alejandra Cazarez Bojorquez' })
const H2 = mk({ id: 'CU-H2', full_name: 'Hist Dos', seller_name: 'Alejandra Cazarez Bojorquez' })
const OTRO = mk({ id: 'CU-OTRO', full_name: 'Otro Cliente', seller_name: 'Lucía · Ventas' })   // texto igual al nombre de Lucía, SIN asignación

function carteraFalsa(asignados: Array<{ profile_id: string; customer_id: string | null; nombre?: string }>, historica: { equivalencias: string[]; clientes: string[] } = { equivalencias: [], clientes: [] }, fallo = false) {
  const llamadas: string[] = []
  const c = new ClienteCartera(async (fn) => {
    llamadas.push(fn)
    if (fallo) return { data: null, error: { message: 'NO_AUTORIZADO' } }
    if (fn === 'cc_mi_cartera') return { data: asignados.map((a) => ({ nombre: 'david espinoza', ...a, asignado_at: 'T' })), error: null }
    if (fn === 'cc_mi_cartera_historica') return { data: { equivalencias: historica.equivalencias, clientes: historica.clientes.map((id) => ({ customer_id: id, seller_name: 'Alejandra Cazarez Bojorquez' })) }, error: null }
    return { data: null, error: { message: 'x' } }
  })
  return { c, llamadas }
}
const filas = () => screen.queryAllByRole('button').filter((b) => b.className === 'card' || b.className === 'op-fila')   // la lista ahora es una tarjeta con filas .op-fila

beforeEach(() => { cleanup(); h.role = 'pos'; h.name = 'Lucía · Ventas'; h.customers = [DAVID, H1, H2, OTRO] })

describe('CARTERA-P1 · Mi cartera (vigente)', () => {
  it('David aparece en la cartera de Lucía aunque seller_name sea NULL, marcado "Asignado"', async () => {
    const f = carteraFalsa([{ profile_id: 'P-DAVID', customer_id: 'CU-DAVID' }])
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    fireEvent.click(screen.getByTestId('vista-cartera'))
    await waitFor(() => expect(filas()).toHaveLength(1))
    expect(filas()[0]).toHaveTextContent('david espinoza'); expect(within(filas()[0]).getByTestId('marca-asignado')).toHaveTextContent('Asignado')
    expect(screen.getByTestId('cartera-explicacion')).toHaveTextContent('asignados a ti por Dirección')
  })
  it('también por PERFIL cuando la asignación no trae id de cliente', async () => {
    const f = carteraFalsa([{ profile_id: 'P-DAVID', customer_id: null }])
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    fireEvent.click(screen.getByTestId('vista-cartera'))
    await waitFor(() => expect(filas()).toHaveLength(1))
  })
  it('David NO pertenece a Alejandra; un nombre igual en seller_name no da pertenencia (nunca por nombre)', async () => {
    h.name = 'Alejandra Cazarez Bojorquez'
    const f = carteraFalsa([])
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    fireEvent.click(screen.getByTestId('vista-cartera'))
    expect(await screen.findByTestId('cartera-vacia')).toHaveTextContent('No tienes clientes asignados.')
    expect(filas()).toHaveLength(0)   // ni David ni los históricos con su mismo nombre
  })
  it('homónimo: "Lucía · Ventas" escrito en seller_name de OTRO cliente no lo mete en su cartera', async () => {
    const f = carteraFalsa([{ profile_id: 'P-DAVID', customer_id: 'CU-DAVID' }])
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    fireEvent.click(screen.getByTestId('vista-cartera'))
    await waitFor(() => expect(filas()).toHaveLength(1))
    expect(screen.queryByText('Otro Cliente')).toBeNull()
  })
  it('error del servidor: se muestra, no se confunde con cartera vacía', async () => {
    const f = carteraFalsa([], undefined, true)
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    fireEvent.click(screen.getByTestId('vista-cartera'))
    expect(await screen.findByTestId('cartera-error')).toHaveTextContent('personal de ventas activo')
    expect(screen.queryByTestId('cartera-vacia')).toBeNull()
  })
  it('búsqueda dentro de Mi cartera', async () => {
    const f = carteraFalsa([{ profile_id: 'P-DAVID', customer_id: 'CU-DAVID' }])
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    fireEvent.click(screen.getByTestId('vista-cartera'))
    await waitFor(() => expect(filas()).toHaveLength(1))
    fireEvent.change(screen.getByPlaceholderText(/Filtrar mi cartera/), { target: { value: 'zzz' } })
    expect(filas()).toHaveLength(0); expect(screen.getByText(/Ninguno coincide/)).toBeInTheDocument()
  })
})

describe('CARTERA-P1 · Cartera histórica (Odoo) tras SEC-C4-B4', () => {
  it('Ventas: la pestaña no existe y no se consulta la cartera histórica', async () => {
    const f = carteraFalsa([{ profile_id: 'P-DAVID', customer_id: 'CU-DAVID' }], { equivalencias: ['Alejandra Cazarez Bojorquez'], clientes: ['CU-H1', 'CU-H2'] })
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    expect(screen.queryByTestId('vista-historica')).toBeNull()
    fireEvent.click(screen.getByTestId('vista-cartera'))
    await waitFor(() => expect(filas()).toHaveLength(1))
    expect(f.llamadas).toEqual(['cc_mi_cartera'])
    expect(screen.queryByText(/Odoo/)).toBeNull(); expect(screen.queryByTestId('marca-historico')).toBeNull()
  })
  it('Dirección conserva las tres pestañas', () => {
    h.role = 'admin'
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={carteraFalsa([]).c} />)
    for (const k of ['all', 'cartera', 'historica']) expect(screen.getByTestId(`vista-${k}`)).toBeInTheDocument()
  })
})

describe('CARTERA-P1 · Todos, Dirección y exportación', () => {
  it('"Todos" para Ventas: sin población precargada y sin consultar carteras al abrir', async () => {
    const f = carteraFalsa([{ profile_id: 'P-DAVID', customer_id: 'CU-DAVID' }])
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(filas()).toHaveLength(0); expect(f.llamadas).toEqual([])
    for (const c of [DAVID, H1, H2, OTRO]) expect(screen.queryByText(c.full_name)).toBeNull()
  })
  it('Dirección (admin) no tiene selector ni consulta carteras', async () => {
    h.role = 'admin'
    const f = carteraFalsa([])
    render(<CustomerDirectory title="Doctores" scope="all" clienteCartera={f.c} />)
    expect(screen.queryByTestId('vista-cartera')).toBeNull(); expect(filas()).toHaveLength(4)
    expect(f.llamadas).toEqual([])
  })
  it('Dirección en la pantalla de Clientes (con selector) tampoco consulta carteras: su vista es la población completa', async () => {
    h.role = 'admin'
    const f = carteraFalsa([])
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(f.llamadas).toEqual([]); expect(filas()).toHaveLength(4)
  })
  it('exportación: solo Dirección (con "Vendedor histórico (Odoo)"); Ventas no tiene exportación', async () => {
    h.columnas = []
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={carteraFalsa([]).c} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.columnas).toEqual([])
    cleanup(); h.role = 'admin'
    render(<CustomerDirectory title="Doctores" scope="all" />)
    expect(h.columnas.find((c) => c.key === 'seller_name')?.label).toBe('Vendedor histórico (Odoo)')
    expect(h.columnas.find((c) => c.label === 'Relación conmigo')).toBeUndefined()
  })
})

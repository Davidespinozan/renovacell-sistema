// @vitest-environment jsdom
// CARTERA-P1 · Clientes (Ventas): "Mi cartera" = asignación VIGENTE del servidor (por id, aunque seller_name sea
// null), "Cartera histórica (Odoo)" = vista SEPARADA por equivalencia explícita (no son asignados), "Todos" sin
// regresiones; nunca por nombre (homónimos o nombres parecidos no dan pertenencia). Clientes falsos.
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

function carteraFalsa(asignados: Array<{ profile_id: string; customer_id: string | null }>, historica: { equivalencias: string[]; clientes: string[] } = { equivalencias: [], clientes: [] }, fallo = false) {
  const llamadas: string[] = []
  const c = new ClienteCartera(async (fn) => {
    llamadas.push(fn)
    if (fallo) return { data: null, error: { message: 'NO_AUTORIZADO' } }
    if (fn === 'cc_mi_cartera') return { data: asignados.map((a) => ({ ...a, nombre: 'n', asignado_at: 'T' })), error: null }
    if (fn === 'cc_mi_cartera_historica') return { data: { equivalencias: historica.equivalencias, clientes: historica.clientes.map((id) => ({ customer_id: id, seller_name: 'Alejandra Cazarez Bojorquez' })) }, error: null }
    return { data: null, error: { message: 'x' } }
  })
  return { c, llamadas }
}
const filas = () => screen.queryAllByRole('button').filter((b) => b.className === 'card')

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
    fireEvent.change(screen.getByPlaceholderText(/Buscar/), { target: { value: 'zzz' } })
    expect(filas()).toHaveLength(0); expect(screen.getByText(/Ninguno coincide/)).toBeInTheDocument()
  })
})

describe('CARTERA-P1 · Cartera histórica (Odoo), separada', () => {
  it('muestra solo la equivalencia del servidor, marcada "Histórico (Odoo)" y NUNCA "Asignado"', async () => {
    h.name = 'Alejandra Carazarez'
    const f = carteraFalsa([], { equivalencias: ['Alejandra Cazarez Bojorquez'], clientes: ['CU-H1', 'CU-H2'] })
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    fireEvent.click(screen.getByTestId('vista-historica'))
    await waitFor(() => expect(filas()).toHaveLength(2))
    for (const b of filas()) { expect(within(b).getByTestId('marca-historico')).toHaveTextContent('Histórico (Odoo)'); expect(within(b).queryByTestId('marca-asignado')).toBeNull() }
    expect(screen.getByTestId('cartera-explicacion')).toHaveTextContent('no son asignaciones vigentes')
    fireEvent.click(screen.getByTestId('vista-cartera'))
    expect(await screen.findByTestId('cartera-vacia')).toBeInTheDocument()   // el histórico no se volvió asignado
  })
  it('sin equivalencia registrada: lo explica (Dirección debe autorizarla)', async () => {
    const f = carteraFalsa([])
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    fireEvent.click(screen.getByTestId('vista-historica'))
    expect(await screen.findByTestId('cartera-vacia')).toHaveTextContent('Dirección aún no ha registrado una equivalencia')
  })
})

describe('CARTERA-P1 · Todos, Dirección y exportación', () => {
  it('"Todos" sin regresiones: toda la población; el vendedor de Odoo se rotula como tal', async () => {
    const f = carteraFalsa([{ profile_id: 'P-DAVID', customer_id: 'CU-DAVID' }])
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    await waitFor(() => expect(f.llamadas).toEqual(expect.arrayContaining(['cc_mi_cartera', 'cc_mi_cartera_historica'])))
    expect(filas()).toHaveLength(4)
    expect(screen.getAllByText(/Odoo: Alejandra Cazarez Bojorquez/).length).toBe(2)
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
  it('exportación: "Vendedor histórico (Odoo)" y "Relación conmigo" (vigente / histórico)', async () => {
    const f = carteraFalsa([{ profile_id: 'P-DAVID', customer_id: 'CU-DAVID' }], { equivalencias: ['Alejandra Cazarez Bojorquez'], clientes: ['CU-H1'] })
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle clienteCartera={f.c} />)
    await waitFor(() => expect(h.columnas.find((c) => c.label === 'Relación conmigo')?.format?.(null, DAVID)).toBe('Asignación vigente'))
    const rel = h.columnas.find((c) => c.label === 'Relación conmigo')!
    expect(rel.format!(null, H1)).toBe('Histórico (Odoo)'); expect(rel.format!(null, OTRO)).toBe('')
    expect(h.columnas.find((c) => c.key === 'seller_name')?.label).toBe('Vendedor histórico (Odoo)')
  })
})

// @vitest-environment jsdom
// SEC-C4-B4 · Clientes para Ventas: "Todos" = buscador seguro (B2), "Mi cartera" = contrato autorizado de cartera,
// histórico Odoo oculto, ficha 360 solo por su RPC autorizada. Dirección conserva su directorio. Clientes falsos.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { BuscadorClientes, type RespuestaRpc } from '../data/ops/buscarClientes'
import { ClienteCartera } from '../data/ops/cartera'
import { ClienteC360 } from '../data/ops/customer360'
import fuenteVentas from './DirectorioVentas.tsx?raw'
import fuenteDirectorio from './CustomerDirectory.tsx?raw'

const h = vi.hoisted(() => ({
  role: 'pos', listados: 0, logout: null as unknown as () => void, ficha: 'falsa' as 'falsa' | 'real',
  fichas: [] as Array<Record<string, unknown>>, pedidos: [] as Array<Record<string, unknown>>, exporta: 0,
}))
vi.mock('../auth/RoleContext', () => ({ useRole: () => ({ role: h.role, user: { name: 'Lucía', email: 'lucia@ventas.test' }, logout: h.logout, setScreen: () => {} }) }))
vi.mock('../data/store/customersStore', async (orig) => {
  const m = await orig<typeof import('../data/store/customersStore')>()
  return { ...m, listCustomers: async () => { h.listados++; return [{ id: 'CU-DIR', full_name: 'Cliente Directorio', phone: '6671112233', city: 'Culiacán', email: 'directorio@x.mx', seller_name: 'Vendedor Odoo', profile_id: null }] } }
})
vi.mock('./Customer360', async (orig) => {
  const m = await orig<typeof import('./Customer360')>()
  return { ...m, Customer360Page: (p: Record<string, unknown>) => {
    if (h.ficha === 'real') return React.createElement(m.Customer360Page, p as never)
    h.fichas.push(p)
    return <div data-testid="ficha-falsa"><button type="button" onClick={p.onOrder as () => void}>pedir</button><button type="button" onClick={p.onBack as () => void}>volver</button></div>
  } }
})
vi.mock('../screens/sales/NuevoPedido', () => ({ NuevoPedido: (p: Record<string, unknown>) => { h.pedidos.push(p); return <div data-testid="pedido-falso" /> } }))
vi.mock('./ExportButton', () => ({ ExportButton: () => { h.exporta++; return null } }))
import { DirectorioVentas } from './DirectorioVentas'
import { CustomerDirectory } from './CustomerDirectory'

const ID1 = '11111111-1111-4111-8111-111111111111', ID2 = '22222222-2222-4222-8222-222222222222', ID3 = '33333333-3333-4333-8333-333333333333'
const fila = (n: number, nombre = `Cuenta ${n}`) => ({ customer_id: `00000000-0000-4000-8000-00000000000${n}`, nombre, telefono_mascara: `••••000${n}` })
type Paso = RespuestaRpc | Promise<RespuestaRpc> | (() => never)
type Asig = { profile_id: string; customer_id: string | null; nombre: string }

function montar(pasos: Paso[] = [], carteras: Asig[][] = [[]], o: { falloCartera?: boolean; identidad?: () => string | null; c360?: ClienteC360 } = {}) {
  const llamadas: Array<{ q: string; limite: number }> = []
  let i = 0, k = 0
  const buscador = new BuscadorClientes({
    identidad: o.identidad ?? (() => 'U-LUCIA'),
    transporte: async (args) => { llamadas.push(args); const p = pasos[Math.min(i++, pasos.length - 1)]; return typeof p === 'function' ? p() : p },
  })
  const rpcs: string[] = []
  const c = new ClienteCartera(async (fn) => {
    rpcs.push(fn)
    if (o.falloCartera) return { data: null, error: { message: 'NO_AUTORIZADO' } }
    // Campos de más a propósito: la pantalla solo debe usar identificador y nombre.
    return { data: carteras[Math.min(k++, carteras.length - 1)].map((a) => ({ ...a, asignado_at: 'T', email: 'fuga@x.mx', phone: '6675550000', seller_name: 'Vendedor Odoo' })), error: null }
  })
  const r = render(<DirectorioVentas title="Clientes" conCartera clienteCartera={c} buscador={buscador} cliente360={o.c360} />)
  return { llamadas, rpcs, buscador, ...r }
}
const input = () => screen.getByLabelText('Buscar cliente') as HTMLInputElement
const escribir = (v: string) => fireEvent.change(input(), { target: { value: v } })
const enter = () => fireEvent.submit(screen.getByTestId('dv-form'))
const ok = (filas: unknown[]): RespuestaRpc => ({ data: filas, error: null, status: 200 })
const vacio = (status: number): RespuestaRpc => ({ data: null, error: [], status })
const falla = (status: number): RespuestaRpc => ({ data: null, error: { message: 'x' }, status })
const resultados = () => screen.queryAllByTestId('dv-resultado')
const irACartera = () => fireEvent.click(screen.getByTestId('vista-cartera'))
const SENSIBLES = ['6675550000', 'fuga@x.mx', 'Vendedor Odoo', '6671112233', 'directorio@x.mx', 'Culiacán', 'lucia@ventas.test']
const sinSensibles = () => { const t = document.body.textContent ?? ''; for (const s of SENSIBLES) expect(t).not.toContain(s) }

beforeEach(() => { cleanup(); h.role = 'pos'; h.listados = 0; h.logout = vi.fn(); h.ficha = 'falsa'; h.fichas = []; h.pedidos = []; h.exporta = 0 })

describe('SEC-C4-B4 · Todos (buscador seguro)', () => {
  it('estado inicial: sin precarga, sin solicitudes, sin cartera', async () => {
    const m = montar()
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByTestId('dv-inicial')).toBeTruthy()
    expect(m.llamadas).toHaveLength(0); expect(m.rpcs).toHaveLength(0); expect(h.listados).toBe(0); expect(resultados()).toHaveLength(0)
  })
  it('escribir NO busca; Enter y el botón sí; límite 6', async () => {
    const m = montar([ok([fila(1)])])
    escribir('c'); escribir('cu'); escribir('cue'); escribir('cuen')
    await act(async () => { await Promise.resolve() })
    expect(m.llamadas).toHaveLength(0)
    enter()
    await waitFor(() => expect(resultados()).toHaveLength(1))
    expect(m.llamadas).toEqual([{ q: 'cuen', limite: 6 }])
    escribir('otra cuenta'); fireEvent.click(screen.getByTestId('dv-buscar'))
    await waitFor(() => expect(m.llamadas).toHaveLength(2))
  })
  it('por nombre: seis resultados con nombre y máscara, nada más', async () => {
    montar([ok([1, 2, 3, 4, 5, 6].map((n) => ({ ...fila(n), phone: '6675550000', email: 'fuga@x.mx', city: 'Culiacán', seller_name: 'Vendedor Odoo' })))])
    escribir('cuenta'); enter()
    await waitFor(() => expect(resultados()).toHaveLength(6))
    const t = screen.getByTestId('dv-resultados').textContent ?? ''
    expect(t).toContain('Cuenta 3'); expect(t).toContain('••••0003'); expect(t).not.toMatch(/\d{5,}/); expect(t).not.toContain('00000000-0000')
    sinSensibles()
  })
  it('por cuatro dígitos; homónimos distintos se abren por su identificador', async () => {
    const m = montar([ok([{ customer_id: ID1, nombre: 'Ana Prueba', telefono_mascara: '••••1234' }, { customer_id: ID2, nombre: 'Ana Prueba', telefono_mascara: '••••1234' }])])
    escribir('1234'); enter()
    await waitFor(() => expect(resultados()).toHaveLength(2))
    expect(m.llamadas[0].q).toBe('1234')
    fireEvent.click(resultados()[1])
    expect(h.fichas[0].customerId).toBe(ID2)
  })
  it('teléfono nulo y cero resultados', async () => {
    montar([ok([{ customer_id: ID1, nombre: 'Sin Tel', telefono_mascara: null }]), ok([])])
    escribir('sin tel'); enter()
    await waitFor(() => expect(screen.getByText('Sin teléfono registrado')).toBeTruthy())
    escribir('zzz nadie'); enter()
    await waitFor(() => expect(screen.getByTestId('dv-vacio')).toBeTruthy())
  })
  it('entrada inválida: aviso y cero solicitudes', async () => {
    const m = montar([ok([fila(1)])])
    for (const q of ['', 'ab', '123', '12345', '%%%', 'a1']) { escribir(q); enter(); await waitFor(() => expect(screen.getByTestId('dv-aviso-entrada_invalida')).toBeTruthy()) }
    expect(m.llamadas).toHaveLength(0)
  })
  it('buscando: botón deshabilitado, sin doble envío', async () => {
    let soltar!: (r: RespuestaRpc) => void
    const m = montar([new Promise<RespuestaRpc>((res) => { soltar = res })])
    escribir('cuenta'); enter()
    await waitFor(() => expect((screen.getByTestId('dv-buscar') as HTMLButtonElement).disabled).toBe(true))
    enter(); enter()
    expect(m.llamadas).toHaveLength(1)
    await act(async () => { soltar(ok([fila(1)])) })
    await waitFor(() => expect(resultados()).toHaveLength(1))
  })
  it('respuesta obsoleta: no pisa la más reciente ni deja el botón atorado', async () => {
    let soltarVieja!: (r: RespuestaRpc) => void
    const m = montar([new Promise<RespuestaRpc>((res) => { soltarVieja = res }), ok([fila(2, 'Beto Reciente')])])
    escribir('ana'); enter()
    await waitFor(() => expect((screen.getByTestId('dv-buscar') as HTMLButtonElement).disabled).toBe(true))
    await act(async () => { void m.buscador.buscar('beto') })
    await act(async () => { soltarVieja(ok([fila(1, 'Ana Vieja')])) })
    expect(screen.queryByText('Ana Vieja')).toBeNull()
    expect((screen.getByTestId('dv-buscar') as HTMLButtonElement).disabled).toBe(false)
  })
  it('cancelación al salir de la pantalla: la respuesta tardía no hace nada', async () => {
    let soltar!: (r: RespuestaRpc) => void
    const m = montar([new Promise<RespuestaRpc>((res) => { soltar = res })])
    escribir('cuenta'); enter()
    await waitFor(() => expect((screen.getByTestId('dv-buscar') as HTMLButtonElement).disabled).toBe(true))
    m.unmount()
    await act(async () => { soltar(ok([fila(1)])) })
    expect(document.body.textContent).not.toContain('Cuenta 1')
  })
  it('401: aviso y sesión por el flujo existente', async () => {
    const m = montar([falla(401)])
    escribir('cuenta'); enter()
    await waitFor(() => expect(screen.getByTestId('dv-aviso-no_autenticado')).toBeTruthy())
    fireEvent.click(screen.getByTestId('dv-relogin'))
    expect(h.logout).toHaveBeenCalledTimes(1); expect(m.llamadas).toHaveLength(1); expect(screen.queryByTestId('dv-reintentar')).toBeNull()
  })
  it('403: sin acceso, sin resultados, sin reintento', async () => {
    const m = montar([falla(403)])
    escribir('cuenta'); enter()
    await waitFor(() => expect(screen.getByTestId('dv-aviso-sin_autorizacion')).toBeTruthy())
    expect(resultados()).toHaveLength(0); expect(screen.queryByTestId('dv-reintentar')).toBeNull(); expect(m.llamadas).toHaveLength(1)
  })
  it('429: aviso de límite, sin reintento automático ni botón', async () => {
    const m = montar([vacio(429)])
    escribir('cuenta'); enter()
    await waitFor(() => expect(screen.getByTestId('dv-aviso-cuota_excedida')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 60))
    expect(m.llamadas).toHaveLength(1); expect(screen.queryByTestId('dv-reintentar')).toBeNull()
  })
  it('red: reintento manual, uno por clic', async () => {
    const m = montar([() => { throw new TypeError('Failed to fetch') }, ok([fila(1)])])
    escribir('cuenta'); enter()
    await waitFor(() => expect(screen.getByTestId('dv-aviso-error_red')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 60))
    expect(m.llamadas).toHaveLength(1)
    fireEvent.click(screen.getByTestId('dv-reintentar'))
    await waitFor(() => expect(resultados()).toHaveLength(1))
    expect(m.llamadas).toHaveLength(2)
  })
  it('5xx: error del servidor sin detalle técnico', async () => {
    montar([{ data: null, error: { message: 'relation "c4a_cuota" does not exist' }, status: 500 }])
    escribir('cuenta'); enter()
    await waitFor(() => expect(screen.getByTestId('dv-aviso-error_servidor')).toBeTruthy())
    expect(document.body.textContent).not.toContain('c4a_cuota')
  })
  it('cambio de sesión: no se reutiliza la caché de otra persona', async () => {
    let quien = 'U-LUCIA'
    const m = montar([ok([fila(1)]), ok([])], [[]], { identidad: () => quien })
    escribir('cuenta'); enter()
    await waitFor(() => expect(resultados()).toHaveLength(1))
    enter()
    await waitFor(() => expect(resultados()).toHaveLength(1))
    expect(m.llamadas).toHaveLength(1)                     // misma persona: caché
    quien = 'U-OTRA'; enter()
    await waitFor(() => expect(screen.getByTestId('dv-vacio')).toBeTruthy())
    expect(m.llamadas).toHaveLength(2)
  })
})

describe('SEC-C4-B4 · Mi cartera', () => {
  const CARTERA: Asig[] = [{ profile_id: 'P1', customer_id: ID3, nombre: 'Doctora Cartera' }, { profile_id: 'P2', customer_id: ID1, nombre: 'Álvaro Núñez' }, { profile_id: 'P3', customer_id: null, nombre: 'Perfil Sin Cuenta' }]
  it('vacía: estado informativo', async () => {
    const m = montar()
    irACartera()
    expect(await screen.findByTestId('cartera-vacia')).toBeTruthy()
    expect(m.rpcs).toEqual(['cc_mi_cartera'])
  })
  it('con cuentas: solo la función de cartera; ni búsqueda ni directorio ni histórico; solo nombre', async () => {
    const m = montar([], [CARTERA])
    irACartera()
    await waitFor(() => expect(screen.getAllByTestId('cartera-fila')).toHaveLength(3))
    expect(m.rpcs).toEqual(['cc_mi_cartera']); expect(m.llamadas).toHaveLength(0); expect(h.listados).toBe(0)
    expect(screen.getAllByTestId('marca-asignado')).toHaveLength(3)
    sinSensibles()
  })
  it('filtro local (sin acentos) solo sobre las cuentas autorizadas, sin solicitudes', async () => {
    const m = montar([ok([fila(1)])], [CARTERA])
    irACartera()
    await waitFor(() => expect(screen.getAllByTestId('cartera-fila')).toHaveLength(3))
    fireEvent.change(screen.getByLabelText('Filtrar mi cartera'), { target: { value: 'alvaro nun' } })
    expect(screen.getAllByTestId('cartera-fila')).toHaveLength(1); expect(screen.getByText('Álvaro Núñez')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filtrar mi cartera'), { target: { value: 'cuenta 1' } })   // existe en "Todos", no en la cartera
    expect(screen.queryAllByTestId('cartera-fila')).toHaveLength(0); expect(screen.getByText(/Ninguno coincide/)).toBeTruthy()
    expect(m.llamadas).toHaveLength(0); expect(m.rpcs).toEqual(['cc_mi_cartera'])
  })
  it('selección: abre la ficha por identificador, con SOLO el nombre como encabezado provisional', async () => {
    montar([], [CARTERA])
    irACartera()
    await waitFor(() => expect(screen.getAllByTestId('cartera-fila')).toHaveLength(3))
    fireEvent.click(screen.getByText('Doctora Cartera'))
    expect(h.fichas).toHaveLength(1)
    expect(h.fichas[0].customerId).toBe(ID3); expect(h.fichas[0].inicial).toEqual({ nombre: 'Doctora Cartera' })
    fireEvent.click(screen.getByText('volver'))
    expect(screen.getByTestId('directorio-ventas')).toBeTruthy()
  })
  it('asignación sin cuenta comercial: visible pero sin ficha que abrir', async () => {
    montar([], [CARTERA])
    irACartera()
    await waitFor(() => expect(screen.getAllByTestId('cartera-fila')).toHaveLength(3))
    fireEvent.click(screen.getByText('Perfil Sin Cuenta'))
    expect(h.fichas).toHaveLength(0)
  })
  it('refresco: vuelve a pedir la cartera y refleja el cambio', async () => {
    const m = montar([], [[CARTERA[0]], CARTERA])
    irACartera()
    await waitFor(() => expect(screen.getAllByTestId('cartera-fila')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('cartera-refrescar'))
    await waitFor(() => expect(screen.getAllByTestId('cartera-fila')).toHaveLength(3))
    expect(m.rpcs).toEqual(['cc_mi_cartera', 'cc_mi_cartera'])
  })
  it('cambiar de pestaña no vuelve a pedir la cartera ni descarga el directorio', async () => {
    const m = montar([], [CARTERA])
    irACartera()
    await waitFor(() => expect(screen.getAllByTestId('cartera-fila')).toHaveLength(3))
    fireEvent.click(screen.getByTestId('vista-all')); irACartera(); fireEvent.click(screen.getByTestId('vista-all')); irACartera()
    await new Promise((r) => setTimeout(r, 20))
    expect(m.rpcs).toEqual(['cc_mi_cartera']); expect(h.listados).toBe(0)
  })
  it('error del servidor: se muestra, no se confunde con vacía, y "Todos" sigue disponible', async () => {
    montar([ok([fila(1)])], [[]], { falloCartera: true })
    irACartera()
    expect(await screen.findByTestId('cartera-error')).toBeTruthy(); expect(screen.queryByTestId('cartera-vacia')).toBeNull()
    fireEvent.click(screen.getByTestId('vista-all')); escribir('cuenta'); enter()
    await waitFor(() => expect(resultados()).toHaveLength(1))
  })
  it('cambio de sesión (pantalla nueva): la cartera es la del nuevo usuario', async () => {
    const a = montar([], [[CARTERA[0]]])
    irACartera()
    await waitFor(() => expect(screen.getAllByTestId('cartera-fila')).toHaveLength(1))
    a.unmount()
    montar([], [[CARTERA[1]]])
    irACartera()
    await waitFor(() => expect(screen.getByText('Álvaro Núñez')).toBeTruthy())
    expect(screen.queryByText('Doctora Cartera')).toBeNull()
  })
})

describe('SEC-C4-B4 · ficha 360 y pedido', () => {
  it('abrir un resultado de "Todos": una sola vía (la ficha), sin consultas de enriquecimiento', async () => {
    const m = montar([ok([{ customer_id: ID1, nombre: 'Ana Prueba', telefono_mascara: '••••1234', email: 'fuga@x.mx' }])])
    escribir('ana'); enter()
    await waitFor(() => expect(resultados()).toHaveLength(1))
    fireEvent.click(resultados()[0])
    expect(h.fichas[0].customerId).toBe(ID1); expect(h.fichas[0].inicial).toEqual({ nombre: 'Ana Prueba' })
    expect(m.llamadas).toHaveLength(1); expect(m.rpcs).toHaveLength(0); expect(h.listados).toBe(0)
  })
  it('acceso denegado por el servidor: aviso claro, encabezado solo con el nombre, sin correo ni portal ni botón de pedido', async () => {
    h.ficha = 'real'
    const pedidas: Array<[string, unknown]> = []
    const c360 = new ClienteC360(async (fn, args) => { pedidas.push([fn, args]); return { data: null, error: { message: 'NO_AUTORIZADO' } } })
    montar([ok([{ customer_id: ID1, nombre: 'Ana Prueba', telefono_mascara: '••••1234' }])], [[]], { c360 })
    escribir('ana'); enter()
    await waitFor(() => expect(resultados()).toHaveLength(1))
    fireEvent.click(resultados()[0])
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso')
    expect(pedidas).toHaveLength(1)
    const t = screen.getByTestId('cliente-360').textContent ?? ''
    expect(t).toContain('Ana Prueba'); expect(t).not.toContain('@'); expect(t).not.toMatch(/portal/i); expect(t).not.toContain('Levantar pedido'); expect(t).not.toMatch(/\d{5,}/)
    fireEvent.click(screen.getByTestId('c360-volver'))
    expect(resultados()).toHaveLength(1)                   // regresa a sus resultados, sin otra búsqueda
  })
  it('acceso permitido: el pedido recibe identificador y nombre; teléfono nulo (lo sella el servidor)', async () => {
    montar([], [[{ profile_id: 'P1', customer_id: ID3, nombre: 'Doctora Cartera' }]])
    irACartera()
    fireEvent.click(await screen.findByText('Doctora Cartera'))
    fireEvent.click(screen.getByText('pedir'))
    expect(h.pedidos[0].customer).toEqual({ id: ID3, name: 'Doctora Cartera', phone: null })
  })
})

describe('SEC-C4-B4 · el directorio según el rol', () => {
  it('Ventas en Clientes: vista segura, sin precarga, sin exportación, sin pestaña histórica', async () => {
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle />)
    await new Promise((r) => setTimeout(r, 40))
    expect(screen.getByTestId('directorio-ventas')).toBeTruthy()
    expect(h.listados).toBe(0); expect(h.exporta).toBe(0)
    expect(screen.queryByTestId('vista-historica')).toBeNull(); expect(document.body.textContent).not.toMatch(/Odoo/)
    sinSensibles()
  })
  it('Dirección: directorio completo, exportación, búsqueda al teclear y las tres pestañas', async () => {
    h.role = 'admin'
    render(<CustomerDirectory title="Clientes" scope="all" carteraToggle />)
    expect(await screen.findByText('Cliente Directorio')).toBeTruthy()
    expect(h.listados).toBe(1); expect(h.exporta).toBeGreaterThan(0)
    expect(screen.queryByTestId('directorio-ventas')).toBeNull()
    expect(screen.getByTestId('vista-historica')).toBeTruthy(); expect(screen.getByText(/Odoo: Vendedor Odoo/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre, correo/), { target: { value: 'zzz' } })
    expect(screen.getByText(/Ninguno coincide/)).toBeTruthy()
  })
  it('Dirección abre la ficha con su encabezado de siempre', async () => {
    h.role = 'admin'
    render(<CustomerDirectory title="Doctores" scope="all" />)
    fireEvent.click(await screen.findByText('Cliente Directorio'))
    expect(h.fichas[0].customerId).toBe('CU-DIR'); expect(h.fichas[0].inicial).toEqual({ nombre: 'Cliente Directorio', email: 'directorio@x.mx', portal: false })
  })
  it('otros roles: nunca el directorio (el servidor decide el resto)', async () => {
    for (const rol of ['warehouse', 'driver', 'doctor']) {
      cleanup(); h.role = rol; h.listados = 0
      render(<CustomerDirectory title="Clientes" scope="all" carteraToggle />)
      await new Promise((r) => setTimeout(r, 30))
      expect(h.listados).toBe(0); expect(screen.queryByText('Cliente Directorio')).toBeNull()
    }
  })
})

describe('SEC-C4-B4 · guardas de fuente', () => {
  const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  it('la vista de Ventas no lee tablas, directorio, ubicaciones ni histórico; no persiste ni usa temporizadores', () => {
    const c = codigo(fuenteVentas)
    for (const p of [/\.from\(/, /\bsupabase\b/, /useCustomers|useCustomerSearch|listCustomers|customersStore/, /doctor_locations|useDoctors/, /miCarteraHistorica|historic|Odoo/i,
      /seller_name|external_id|\bemail\b|\bcity\b|\brfc\b|\.phone\b/i, /service_role/, /setInterval|setTimeout/, /localStorage|sessionStorage|indexedDB/, /ExportButton/, /console\./]) expect(c).not.toMatch(p)
    expect(c).not.toMatch(/onChange=\{[^}]*buscar\(/)
    expect(c).toMatch(/phone: null/)
  })
  it('el directorio completo solo se monta para Dirección', () => {
    const c = codigo(fuenteDirectorio)
    expect(c).toMatch(/if \(role !== 'admin'\) return <DirectorioVentas/)
    expect(c.match(/useCustomers\(/g)).toHaveLength(1)
    expect(c.indexOf('useCustomers(')).toBeGreaterThan(c.indexOf('function DirectorioDireccion'))
  })
})

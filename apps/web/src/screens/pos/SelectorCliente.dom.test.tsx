// @vitest-environment jsdom
// SEC-C4-B3 · Selector seguro de cliente en la Caja (Ventas): cartera primero, búsqueda EXPLÍCITA con el servicio B2,
// solo nombre y máscara, sin precargar el directorio. Dirección conserva su selector. Clientes falsos.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { SelectorClienteVentas, type ClienteElegido } from './SelectorCliente'
import { BuscadorClientes, type RespuestaRpc } from '../../data/ops/buscarClientes'
import { ClienteCartera } from '../../data/ops/cartera'
import { useCustomers } from '../../data/hooks/useCustomers'
import fuenteSelector from './SelectorCliente.tsx?raw'
import fuenteCaja from './Caja.tsx?raw'

const h = vi.hoisted(() => ({ role: 'pos', listados: 0, logout: null as unknown as () => void }))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: h.role, user: { name: 'Lucía · Ventas', email: 'x@y' }, logout: h.logout, setScreen: () => {} }) }))
vi.mock('../../data/store/customersStore', async (orig) => {
  const m = await orig<typeof import('../../data/store/customersStore')>()
  return { ...m, listCustomers: async () => { h.listados++; return [{ id: 'CU-DIR', full_name: 'Cliente Directorio', phone: '6671112233', city: 'Culiacán', email: 'c@x.mx', profile_id: null }] } }
})
import { Caja } from './Caja'

const ID1 = '11111111-1111-4111-8111-111111111111', ID2 = '22222222-2222-4222-8222-222222222222', ID3 = '33333333-3333-4333-8333-333333333333'
const FILA1 = { customer_id: ID1, nombre: 'Ana Prueba', telefono_mascara: '••••1234' }
const FILA2 = { customer_id: ID2, nombre: 'Ana Prueba', telefono_mascara: '••••9876' }   // homónima: se distingue por máscara, se elige por id

type Paso = RespuestaRpc | Promise<RespuestaRpc> | (() => never)
function montar(pasos: Paso[] = [], cartera: Array<{ profile_id: string; customer_id: string | null; nombre: string }> = [], o: { falloCartera?: boolean; identidad?: () => string | null } = {}) {
  const llamadas: Array<{ q: string; limite: number }> = []
  let i = 0
  const buscador = new BuscadorClientes({
    identidad: o.identidad ?? (() => 'U-LUCIA'),
    transporte: async (args) => { llamadas.push(args); const p = pasos[Math.min(i++, pasos.length - 1)]; return typeof p === 'function' ? p() : p },
  })
  const rpcs: string[] = []
  const c = new ClienteCartera(async (fn) => {
    rpcs.push(fn)
    if (o.falloCartera) return { data: null, error: { message: 'NO_AUTORIZADO' } }
    return { data: cartera.map((a) => ({ ...a, asignado_at: 'T' })), error: null }
  })
  const elegidos: Array<ClienteElegido | null> = []
  const sesion = vi.fn(), cerrar = vi.fn()
  const r = render(<SelectorClienteVentas buscador={buscador} cartera={c} onPick={(x) => elegidos.push(x)} onClose={cerrar} alExpirarSesion={sesion} />)
  return { llamadas, rpcs, elegidos, sesion, cerrar, buscador, ...r }
}
const input = () => screen.getByLabelText('Buscar cliente') as HTMLInputElement
const escribir = (v: string) => fireEvent.change(input(), { target: { value: v } })
const enter = () => fireEvent.submit(screen.getByTestId('sc-form'))
const ok = (filas: unknown[]): RespuestaRpc => ({ data: filas, error: null, status: 200 })
const vacio = (status: number): RespuestaRpc => ({ data: null, error: [], status })
const falla = (status: number): RespuestaRpc => ({ data: null, error: { message: 'x' }, status })

beforeEach(() => { cleanup(); h.role = 'pos'; h.listados = 0; h.logout = vi.fn() })

describe('SEC-C4-B3 · Mi cartera', () => {
  it('muestra primero las cuentas asignadas (solo con cuenta comercial) sin gastar búsquedas', async () => {
    const m = montar([], [{ profile_id: 'P1', customer_id: ID3, nombre: 'Doctora Cartera' }, { profile_id: 'P2', customer_id: null, nombre: 'Sin Cuenta' }])
    await waitFor(() => expect(screen.getAllByTestId('sc-cartera-fila')).toHaveLength(1))
    expect(screen.getByText('Doctora Cartera')).toBeTruthy()
    expect(screen.queryByText('Sin Cuenta')).toBeNull()
    expect(m.rpcs).toEqual(['cc_mi_cartera'])
    expect(m.llamadas).toHaveLength(0)
    fireEvent.click(screen.getByTestId('sc-cartera-fila'))
    expect(m.elegidos).toEqual([{ id: ID3, name: 'Doctora Cartera', phone: null, mascara: null }])
  })
  it('cartera vacía y cartera con error no bloquean la búsqueda', async () => {
    montar()
    await waitFor(() => expect(screen.getByText(/Aún no tienes clientes asignados/)).toBeTruthy())
    cleanup()
    const m = montar([ok([FILA1])], [], { falloCartera: true })
    await waitFor(() => expect(screen.getByTestId('sc-cartera').querySelector('[role=alert]')).toBeTruthy())
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getAllByTestId('sc-resultado')).toHaveLength(1))
    expect(m.llamadas).toHaveLength(1)
  })
})

describe('SEC-C4-B3 · búsqueda explícita', () => {
  it('escribir NO busca; Enter y el botón sí, con límite 6', async () => {
    const m = montar([ok([FILA1])])
    escribir('a'); escribir('an'); escribir('ana'); escribir('ana p')
    await act(async () => { await Promise.resolve() })
    expect(m.llamadas).toHaveLength(0)
    enter()
    await waitFor(() => expect(screen.getAllByTestId('sc-resultado')).toHaveLength(1))
    expect(m.llamadas).toHaveLength(1)
    expect(m.llamadas[0].limite).toBe(6)
    escribir('otra busqueda')
    fireEvent.click(screen.getByTestId('sc-buscar'))
    await waitFor(() => expect(m.llamadas).toHaveLength(2))
  })
  it('por nombre y por 4 dígitos: solo nombre y máscara; homónimos se eligen por id', async () => {
    const m = montar([ok([FILA1, FILA2])])
    escribir('1234'); enter()
    await waitFor(() => expect(screen.getAllByTestId('sc-resultado')).toHaveLength(2))
    const texto = screen.getByTestId('sc-resultados').textContent ?? ''
    expect(texto).toContain('Ana Prueba'); expect(texto).toContain('••••1234'); expect(texto).toContain('••••9876')
    expect(texto).not.toMatch(/\d{5,}/); expect(texto).not.toContain('@'); expect(texto).not.toContain(ID1)
    fireEvent.click(screen.getAllByTestId('sc-resultado')[1])
    expect(m.elegidos).toEqual([{ id: ID2, name: 'Ana Prueba', phone: null, mascara: '••••9876' }])
  })
  it('cliente sin teléfono: se dice, sin inventar máscara', async () => {
    montar([ok([{ customer_id: ID1, nombre: 'Sin Tel', telefono_mascara: null }])])
    escribir('sin tel'); enter()
    await waitFor(() => expect(screen.getByText('Sin teléfono registrado')).toBeTruthy())
  })
  it('campos de más en la respuesta no llegan a la pantalla', async () => {
    montar([ok([{ ...FILA1, phone: '6679990000', email: 'ana@x.mx', city: 'Culiacán', seller_name: 'Vendedor Odoo', meta: { rfc: 'XAXX010101000' } }])])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getAllByTestId('sc-resultado')).toHaveLength(1))
    const t = document.body.textContent ?? ''
    for (const s of ['6679990000', 'ana@x.mx', 'Culiacán', 'Vendedor Odoo', 'XAXX010101000']) expect(t).not.toContain(s)
  })
  it('entrada inválida: aviso y CERO solicitudes', async () => {
    const m = montar([ok([FILA1])])
    for (const q of ['', 'ab', '123', '12345', '%%%', 'a1']) {
      escribir(q); enter()
      await waitFor(() => expect(screen.getByTestId('sc-aviso-entrada_invalida')).toBeTruthy())
    }
    expect(m.llamadas).toHaveLength(0)
  })
  it('sin resultados', async () => {
    montar([ok([])])
    escribir('zzz inexistente'); enter()
    await waitFor(() => expect(screen.getByTestId('sc-vacio')).toBeTruthy())
  })
  it('estado "buscando" con el botón deshabilitado (sin doble envío)', async () => {
    let soltar!: (r: RespuestaRpc) => void
    const m = montar([new Promise<RespuestaRpc>((res) => { soltar = res })])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getByTestId('sc-buscando')).toBeTruthy())
    expect((screen.getByTestId('sc-buscar') as HTMLButtonElement).disabled).toBe(true)
    enter(); enter()
    expect(m.llamadas).toHaveLength(1)
    await act(async () => { soltar(ok([FILA1])) })
    await waitFor(() => expect(screen.getAllByTestId('sc-resultado')).toHaveLength(1))
  })
  it('repetir la misma búsqueda usa la caché en memoria (no gasta cuota)', async () => {
    const m = montar([ok([FILA1])])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getAllByTestId('sc-resultado')).toHaveLength(1))
    escribir('  ANA '); enter()
    await waitFor(() => expect(screen.getAllByTestId('sc-resultado')).toHaveLength(1))
    expect(m.llamadas).toHaveLength(1)
  })
})

describe('SEC-C4-B3 · errores', () => {
  it('401: mensaje y acción de sesión por el flujo existente; sin reintento', async () => {
    const m = montar([falla(401)])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getByTestId('sc-aviso-no_autenticado')).toBeTruthy())
    expect(screen.queryByTestId('sc-reintentar')).toBeNull()
    fireEvent.click(screen.getByTestId('sc-relogin'))
    expect(m.sesion).toHaveBeenCalledTimes(1)
    expect(m.llamadas).toHaveLength(1)
  })
  it('403: sin acceso, sin resultados y sin reintento', async () => {
    const m = montar([falla(403)])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getByTestId('sc-aviso-sin_autorizacion')).toBeTruthy())
    expect(screen.queryAllByTestId('sc-resultado')).toHaveLength(0)
    expect(screen.queryByTestId('sc-reintentar')).toBeNull()
    expect(m.llamadas).toHaveLength(1)
  })
  it('429: aviso de límite, sin reintento automático ni botón de reintento', async () => {
    const m = montar([vacio(429)])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getByTestId('sc-aviso-cuota_excedida')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 60))
    expect(m.llamadas).toHaveLength(1)
    expect(screen.queryByTestId('sc-reintentar')).toBeNull()
  })
  it('400 del servidor se muestra como entrada inválida', async () => {
    montar([vacio(400)])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getByTestId('sc-aviso-entrada_invalida')).toBeTruthy())
  })
  it('error de red: reintento MANUAL (uno por clic)', async () => {
    const m = montar([() => { throw new TypeError('Failed to fetch') }, ok([FILA1])])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getByTestId('sc-aviso-error_red')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 60))
    expect(m.llamadas).toHaveLength(1)
    fireEvent.click(screen.getByTestId('sc-reintentar'))
    await waitFor(() => expect(screen.getAllByTestId('sc-resultado')).toHaveLength(1))
    expect(m.llamadas).toHaveLength(2)
  })
  it('5xx: error del servidor sin detalle técnico', async () => {
    montar([{ data: null, error: { message: 'relation "c4a_cuota" does not exist', code: '42P01' }, status: 500 }])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getByTestId('sc-aviso-error_servidor')).toBeTruthy())
    expect(document.body.textContent).not.toContain('c4a_cuota')
  })
  it('respuesta con forma inesperada no pinta filas', async () => {
    montar([ok([{ id: 'x', full_name: 'Forma Vieja', phone: '6671234567' }])])
    escribir('forma'); enter()
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(document.body.textContent).not.toContain('6671234567')
  })
})

describe('SEC-C4-B3 · concurrencia y sesión', () => {
  it('una respuesta vieja no pisa la búsqueda más reciente', async () => {
    let soltarVieja!: (r: RespuestaRpc) => void
    const m = montar([new Promise<RespuestaRpc>((res) => { soltarVieja = res }), ok([{ customer_id: ID2, nombre: 'Beto Reciente', telefono_mascara: '••••0002' }])])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getByTestId('sc-buscando')).toBeTruthy())
    await act(async () => { void m.buscador.buscar('beto') })      // otra búsqueda del mismo servicio cancela la anterior
    escribir('beto'); 
    await act(async () => { soltarVieja(ok([{ customer_id: ID1, nombre: 'Ana Vieja', telefono_mascara: '••••0001' }])) })
    expect(screen.queryByText('Ana Vieja')).toBeNull()
    expect(screen.queryByTestId('sc-buscando')).toBeNull()
    expect((screen.getByTestId('sc-buscar') as HTMLButtonElement).disabled).toBe(false)
  })
  it('cerrar el selector con una búsqueda en curso: la respuesta tardía no hace nada', async () => {
    let soltar!: (r: RespuestaRpc) => void
    const m = montar([new Promise<RespuestaRpc>((res) => { soltar = res })])
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getByTestId('sc-buscando')).toBeTruthy())
    m.unmount()
    await act(async () => { soltar(ok([FILA1])) })
    expect(m.elegidos).toHaveLength(0)
  })
  it('cambio de sesión: la caché de otra persona no se reutiliza', async () => {
    let quien = 'U-LUCIA'
    const m = montar([ok([FILA1]), ok([])], [], { identidad: () => quien })
    escribir('ana'); enter()
    await waitFor(() => expect(screen.getAllByTestId('sc-resultado')).toHaveLength(1))
    quien = 'U-OTRA'
    enter()
    await waitFor(() => expect(screen.getByTestId('sc-vacio')).toBeTruthy())
    expect(m.llamadas).toHaveLength(2)
  })
  it('mostrador limpia la selección', async () => {
    const m = montar()
    fireEvent.click(screen.getByTestId('sc-mostrador'))
    expect(m.elegidos).toEqual([null])
  })
})

describe('SEC-C4-B3 · la Caja según el rol', () => {
  function Sonda({ activo }: { activo: boolean }) { const { data, loading } = useCustomers(activo); return <div data-testid="sonda">{loading ? 'cargando' : `n=${data.length}`}</div> }
  it('useCustomers(false) no consulta el directorio; por defecto sí (compatibilidad)', async () => {
    render(<Sonda activo={false} />)
    await waitFor(() => expect(screen.getByTestId('sonda').textContent).toBe('n=0'))
    expect(h.listados).toBe(0)
    cleanup()
    render(<Sonda activo />)
    await waitFor(() => expect(screen.getByTestId('sonda').textContent).toBe('n=1'))
    expect(h.listados).toBe(1)
  })
  const abrirSelector = () => fireEvent.click(screen.getByText('Elegir').closest('button') as HTMLButtonElement)
  it('Ventas: la Caja NO precarga clientes y abre el selector seguro', async () => {
    h.role = 'pos'
    render(<Caja />)
    abrirSelector()
    await waitFor(() => expect(screen.getByTestId('selector-cliente-ventas')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 50))
    expect(h.listados).toBe(0)
    expect(document.body.textContent).not.toContain('Cliente Directorio')
    fireEvent.click(screen.getByTestId('sc-mostrador'))
    expect(screen.queryByTestId('selector-cliente-ventas')).toBeNull()
    expect(screen.getByText('Elegir')).toBeTruthy()
  })
  it('Dirección: conserva su selector con el directorio', async () => {
    h.role = 'admin'
    render(<Caja />)
    await waitFor(() => expect(h.listados).toBe(1))
    abrirSelector()
    expect(screen.queryByTestId('selector-cliente-ventas')).toBeNull()
    await waitFor(() => expect(screen.getByText('Cliente Directorio')).toBeTruthy())
  })
  it('otros roles no reciben el directorio (sin acceso nuevo)', async () => {
    for (const rol of ['warehouse', 'driver', 'doctor']) {
      cleanup(); h.role = rol; h.listados = 0
      render(<Caja />)
      await new Promise((r) => setTimeout(r, 30))
      expect(h.listados).toBe(0)
    }
  })
})

describe('SEC-C4-B3 · guardas de fuente', () => {
  const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  it('el selector no lee tablas, no usa el directorio y no abre expedientes', () => {
    const c = codigo(fuenteSelector)
    for (const p of [/\.from\(/, /supabase/, /useCustomers|useCustomerSearch|listCustomers|customersStore/, /Customer360|c360/i, /doctor_locations/, /seller_name|external_id|\bemail\b|\bcity\b|\brfc\b/i, /service_role/, /setInterval|setTimeout/, /localStorage|sessionStorage/]) expect(c).not.toMatch(p)
    expect(c).not.toMatch(/onChange=\{[^}]*buscar\(/)            // no busca al teclear
  })
  it('la Caja condiciona la precarga a Dirección y usa el selector seguro para los demás', () => {
    const c = codigo(fuenteCaja)
    expect(c).toMatch(/useCustomers\(esDireccion\)/)
    expect(c).toMatch(/const esDireccion = role === 'admin'/)
    expect(c).toMatch(/pickOpen && !esDireccion && \(\s*<SelectorClienteVentas/)
    expect(c).toMatch(/pickOpen && esDireccion && \(\s*<ClientPicker/)
    expect(c.match(/useCustomers\(/g)).toHaveLength(1)
  })
})

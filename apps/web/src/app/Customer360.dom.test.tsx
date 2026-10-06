// @vitest-environment jsdom
// C360-F3 · Ficha Customer 360 de página completa: pestañas según lo que el SERVIDOR manda por rol, edición
// solo por comandos cliente_* y autoservicio del doctor. El RPC se inyecta (sin Supabase, sin red).
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { Customer360Page } from './Customer360'
import { AutoservicioCliente } from './AutoservicioCliente'
import { PerfilesFiscalesEditor } from './Cliente360Editores'
import { ClienteC360, type Cliente360 } from '../data/ops/customer360'
import { ClienteAtencion } from '../data/ops/atencion'

afterEach(cleanup)

const ficha = (x: Partial<Cliente360> = {}): Cliente360 => ({
  customer_id: 'C1', rol: 'direccion',
  permisos: { contacto: ['full_name', 'email', 'city', 'country'], telefonos: true, domicilios: true, fiscal: true, notas: true, cartera: false, adoptar_alta: true },
  resumen: { nombre: 'Dra. Ruiz', activo: true, creado_at: null, origen: 'portal', portal: { tiene: true, verificado: true, activo: true }, vendedor: null, vendedor_historico: null },
  contacto: { email: 'r@x.mx', ciudad: 'Mazatlán', pais: 'México', telefonos: [{ id: 't1', numero: '669 111 2222', etiqueta: 'whatsapp', es_principal: true, origen: 'manual' }], alta: null, notas: [] },
  domicilios: { lista: [], archivados: 0, alta: null },
  facturacion: [{ id: 'f1', alias: 'Clínica', rfc: 'AAA010101AA1', es_predeterminado: true }],
  comercial: { historial: [], atribucion: { origen: null, referido: null, prospecto: null }, conversacion: null, carrito: null },
  pedidos: [], resumen_pedidos: { n: 0, total: 0, ultimo: null }, pagos: [], facturas: [], actividad: [],
  profesional: { cedula: '123', organizacion: null, especialidad: null, verificado: true, verification: null, sep: null, identidad: null, ultimo_acceso: null },
  ...x,
} as Cliente360)

function falso(datos: Cliente360) {
  const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const c = new ClienteC360(async (fn, args) => { llamadas.push({ fn, args }); return { data: fn === 'cliente_360' ? datos : { id: 'nuevo' }, error: null } })
  return { c, llamadas }
}
const atencionMuda = new ClienteAtencion(async () => ({ data: [], error: null }) as never)

describe('Customer360Page', () => {
  it('Dirección ve todas las pestañas y el encabezado del servidor', async () => {
    const { c } = falso(ficha())
    render(<Customer360Page customerId="C1" onBack={() => {}} cliente={c} atencion={atencionMuda} />)
    await screen.findByText('Dra. Ruiz')
    for (const t of ['resumen', 'contacto', 'domicilios', 'facturacion', 'comercial', 'pedidos', 'pagos', 'facturas', 'conversacion', 'actividad']) expect(screen.getByTestId(`tab-${t}`)).toBeTruthy()
  })
  it('vendedor: sin pestaña de pagos cuando el servidor no los manda', async () => {
    const { c } = falso(ficha({ rol: 'vendedor', pagos: undefined, profesional: undefined }))
    render(<Customer360Page customerId="C1" onBack={() => {}} cliente={c} atencion={atencionMuda} />)
    await screen.findByText('Dra. Ruiz')
    expect(screen.queryByTestId('tab-pagos')).toBeNull()
  })
  it('agregar teléfono llama SOLO al comando cliente_telefono_guardar y recarga', async () => {
    const { c, llamadas } = falso(ficha())
    render(<Customer360Page customerId="C1" onBack={() => {}} cliente={c} atencion={atencionMuda} />)
    await screen.findByText('Dra. Ruiz')
    fireEvent.click(screen.getByTestId('tab-contacto'))
    fireEvent.click(screen.getByTestId('telefono-agregar'))
    fireEvent.change(screen.getByLabelText('Número'), { target: { value: '669 333 4444' } })
    fireEvent.click(screen.getByTestId('telefono-guardar'))
    await waitFor(() => expect(llamadas.filter((l) => l.fn === 'cliente_360').length).toBe(2))
    const g = llamadas.find((l) => l.fn === 'cliente_telefono_guardar')!
    expect(g.args).toMatchObject({ p_customer: 'C1', p_numero: '669 333 4444' })
    expect(llamadas.some((l) => /^(rpc_)?update|insert/.test(l.fn))).toBe(false)
  })
  it('sin permisos de edición no hay botones de alta', async () => {
    const { c } = falso(ficha({ rol: 'facturacion', permisos: { contacto: [], telefonos: false, domicilios: false, fiscal: true, notas: false, cartera: false, adoptar_alta: false } }))
    render(<Customer360Page customerId="C1" onBack={() => {}} cliente={c} atencion={atencionMuda} />)
    await screen.findByText('Dra. Ruiz')
    fireEvent.click(screen.getByTestId('tab-contacto'))
    expect(screen.queryByTestId('telefono-agregar')).toBeNull()
  })
  it('error del servidor → aviso claro y encabezado provisional del directorio', async () => {
    const c = new ClienteC360(async () => ({ data: null, error: { message: 'NO_AUTORIZADO: no puedes ver este cliente' } }))
    render(<Customer360Page customerId="C1" onBack={() => {}} cliente={c} atencion={atencionMuda} inicial={{ nombre: 'Dr. Beto', portal: false }} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Dr. Beto')).toBeTruthy()
    expect(screen.getByText(/Sin acceso al portal/)).toBeTruthy()
  })
})

describe('AutoservicioCliente (Mi perfil del doctor)', () => {
  it('lee su propia ficha (p_customer null) y muestra teléfonos y perfiles fiscales', async () => {
    const { c, llamadas } = falso(ficha({ rol: 'dueno', comercial: undefined, actividad: undefined, profesional: undefined }))
    render(<AutoservicioCliente cliente={c} />)
    await screen.findByTestId('autoservicio-telefonos')
    expect(screen.getByTestId('autoservicio-fiscal')).toBeTruthy()
    expect(llamadas[0]).toEqual({ fn: 'cliente_360', args: { p_customer: null } })
    expect(screen.getAllByTestId('perfil-fiscal').length).toBe(1)
  })
  it('sin expediente de cliente → mensaje, sin editores', async () => {
    const c = new ClienteC360(async () => ({ data: null, error: { message: 'CLIENTE_NO_ENCONTRADO' } }))
    render(<AutoservicioCliente cliente={c} />)
    expect(await screen.findByText(/expediente de cliente/)).toBeTruthy()
    expect(screen.queryByTestId('autoservicio-telefonos')).toBeNull()
  })
})

describe('selector de perfil fiscal en checkout', () => {
  it('elegir un perfil solo informa su id; no edita ni archiva', () => {
    const { c, llamadas } = falso(ficha())
    const elegidos: string[] = []
    const perfiles = [{ id: 'f1', alias: 'Clínica', rfc: 'AAA010101AA1', es_predeterminado: true }, { id: 'f2', alias: 'Persona física', rfc: 'BBB010101BB2', es_predeterminado: false }]
    render(<PerfilesFiscalesEditor customerId={null} perfiles={perfiles as never} editable cliente={c} onCambio={() => {}} seleccion={{ valor: 'f1', onElegir: (id) => elegidos.push(id) }} />)
    expect((screen.getByLabelText('Clínica') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByLabelText('Persona física'))
    expect(elegidos).toEqual(['f2'])
    expect(screen.queryByTestId('fiscal-archivar')).toBeNull()
    expect(llamadas).toEqual([])
  })
})

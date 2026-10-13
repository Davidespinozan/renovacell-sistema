// @vitest-environment jsdom
// SEC-C4-B5b · Caja: DATOS FISCALES DE LA VENTA ≠ PERFIL FISCAL PERMANENTE.
// Ventas captura el receptor solo para la venta (sin leer ni escribir el expediente fiscal); viaja en la MISMA
// operación del cobro (vender_pos). Dirección conserva precarga y actualización. Sin doble cobro. Datos falsos.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { isFiscalProfileComplete } from '../../data/ops/fiscal'
import fuente from './Caja.tsx?raw'

const MAESTRO = { rfc: 'MAE010101AB1', razon_social: 'PERFIL PERMANENTE SA', regimen: '601', cp: '80000', uso_cfdi: 'G03', email_facturacion: 'maestro@fiscal.test' }
const CAPTURA = { rfc: 'XAXX010101000', razon_social: 'CAPTURA DE LA VENTA', regimen: '616', cp: '80010', uso_cfdi: 'S01', email_facturacion: 'captura@venta.test' }
const ID = '11111111-1111-4111-8111-111111111111', ID2 = '22222222-2222-4222-8222-222222222222'

type Venta = { lines: unknown; total: number; method: string; opts: Record<string, unknown> }
const h = vi.hoisted(() => ({
  role: 'pos', tablas: [] as string[], rpcs: [] as string[], upserts: [] as unknown[][], ventas: [] as Venta[], ops: 0, estados: [] as string[],
  respuestas: [] as unknown[], respuestaUpsert: { ok: true } as { ok: boolean; error?: string }, maestro: null as unknown, captura: null as unknown, previa: false, elegir: null as unknown,
}))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: h.role, user: { name: 'Lucía', email: 'lucia@ventas.test' }, logout: () => {} }) }))
vi.mock('../../lib/supabase', () => {
  const cadena = (t: string) => { const c: Record<string, unknown> = {}; for (const k of ['select', 'eq']) c[k] = () => c; c.maybeSingle = async () => ({ data: t === 'customers' ? { meta: { fiscal: h.maestro } } : null, error: null }); return c }
  return { hasSupabase: true, currentUserId: () => 'U-1', supabase: { from: (t: string) => { h.tablas.push(t); return cadena(t) }, rpc: async (fn: string) => { h.rpcs.push(fn); return { data: null, error: null } } } }
})
vi.mock('../../data/store/customersStore', () => ({
  listCustomers: async () => [{ id: ID, full_name: 'Cliente Directorio', phone: null, city: null, profile_id: null }],
  customerFiscal: (c: { meta?: { fiscal?: unknown } } | null) => ({ rfc: '', razon_social: '', regimen: '', cp: '', uso_cfdi: '', email_facturacion: '', ...((c?.meta?.fiscal as object) ?? {}) }),
  upsertCustomerFiscal: async (...a: unknown[]) => { h.upserts.push(a); return h.respuestaUpsert },
}))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'P1', name: 'Producto Uno', price: 100, sellable: true, category: null, sku: 'SKU1', image_url: null }] }), isActiveProduct: () => true }))
vi.mock('../../data/hooks/useLots', () => ({ useLots: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useDoctors', () => ({ useDoctors: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useCustody', () => ({ useCustodies: () => ({ data: [] }), useCustodyStock: () => ({ data: [] }) }))
vi.mock('../../data/store/custodyStore', () => ({ saldoPorProducto: () => ({}), custodiaAbiertaDe: () => null }))
vi.mock('../../data/hooks/useVolumePrices', () => ({ useVolumePrices: () => ({ data: [] }) }))
vi.mock('../../data/ops/stock', () => ({ LOW_STOCK: 5, stockByProduct: () => ({}), stockInfoFor: () => ({ tracked: true, qty: 10, status: 'ok' }) }))
vi.mock('../../data/ops/pos', () => ({
  newPosOp: () => ({ orderId: `OP-${++h.ops}`, folio: `POS-${h.ops}` }),
  venderPOS: async (lines: unknown, total: number, method: string, opts: Record<string, unknown>) => { h.ventas.push({ lines, total, method, opts }); return h.respuestas[Math.min(h.ventas.length - 1, h.respuestas.length - 1)] },
}))
vi.mock('../../data/ops/w1Command', () => ({ estadoOperacion: async (id: string) => { h.estados.push(id); return h.previa } }))
vi.mock('./ventaRecibo', () => ({ enviarReciboWhatsApp: () => {}, imprimirVenta: () => {}, VentaTicketPrint: () => null }))
vi.mock('./BarraVenta', () => ({ BarraVenta: () => null }))
vi.mock('../../app/FiscalFields', () => ({ FiscalFields: ({ value, onChange }: { value: { rfc: string }; onChange: (f: unknown) => void }) => <button type="button" data-testid="form-fiscal" onClick={() => onChange(h.captura)}>fiscal:{value.rfc || 'vacío'}</button> }))
vi.mock('./SelectorCliente', () => ({ SelectorClienteVentas: ({ onPick }: { onPick: (c: unknown) => void }) => <button type="button" data-testid="selector-seguro" onClick={() => onPick(h.elegir)}>elegir</button> }))
import { Caja } from './Caja'

const exito = () => ({ ok: true, order: { id: 'OP-1', external_ref: 'POS-1', total: 100, payment_method: 'efectivo', doctor_id: null, customer_id: null, shipping_meta: {}, items: [] } })
const agregar = () => fireEvent.click(document.querySelector('.poscard') as HTMLElement)
const cobrar = () => screen.getByRole('button', { name: /Cobrar|Cobrando/ }) as HTMLButtonElement
const pedirFactura = () => fireEvent.click(screen.getByRole('checkbox'))
const elegirCliente = async (c: unknown = { id: ID, name: 'Ana Prueba', phone: null, mascara: '••••1234' }) => {
  h.elegir = c
  fireEvent.click(screen.getByText(/^(Elegir|Cambiar)$/).closest('button') as HTMLButtonElement)
  if (h.role === 'admin') fireEvent.click(await screen.findByText('Cliente Directorio'))
  else fireEvent.click(screen.getByTestId('selector-seguro'))
}
const llenar = async () => { fireEvent.click(await screen.findByTestId('form-fiscal')); await waitFor(() => expect(cobrar().disabled).toBe(false)) }
const vendido = () => waitFor(() => expect(screen.getByText('Venta registrada')).toBeTruthy())

beforeEach(() => {
  cleanup(); h.role = 'pos'; h.tablas = []; h.rpcs = []; h.upserts = []; h.ventas = []; h.ops = 0; h.estados = []; h.previa = false
  h.respuestas = [exito()]; h.respuestaUpsert = { ok: true }; h.maestro = MAESTRO; h.captura = CAPTURA
})

describe('SEC-C4-B5b · Ventas', () => {
  it('mostrador sin factura: igual que siempre, sin lecturas ni escrituras fiscales', async () => {
    render(<Caja />); agregar()
    fireEvent.click(cobrar()); await vendido()
    expect(h.ventas).toHaveLength(1)
    const o = h.ventas[0].opts
    expect(o.customerId).toBeNull(); expect(o.customer).toBeNull(); expect(o.invoiceRequested).toBe(false); expect(o.invoiceMeta).toBeNull()
    expect(h.ventas[0].total).toBe(100); expect(h.ventas[0].method).toBe('efectivo'); expect(h.ventas[0].lines).toEqual([{ product_id: 'P1', qty: 1, unit_price: 100 }])
    expect(h.tablas).toEqual([]); expect(h.upserts).toEqual([])
  })
  it('mostrador con factura: el receptor viaja en la venta; no hay perfil permanente que tocar', async () => {
    expect(isFiscalProfileComplete(CAPTURA)).toBe(true)
    render(<Caja />); agregar(); pedirFactura()
    expect(screen.getByTestId('caja-fiscal-solo-venta')).toHaveTextContent('No modificarán el perfil fiscal permanente')
    await llenar(); fireEvent.click(cobrar()); await vendido()
    expect(h.ventas[0].opts.invoiceRequested).toBe(true); expect(h.ventas[0].opts.invoiceMeta).toEqual({ receiver: CAPTURA })
    expect(h.tablas).toEqual([]); expect(h.upserts).toEqual([])
  })
  it('cliente comercial sin factura: no consulta nada fiscal', async () => {
    render(<Caja />); agregar(); await elegirCliente()
    fireEvent.click(cobrar()); await vendido()
    expect(h.ventas[0].opts.customerId).toBe(ID); expect(h.ventas[0].opts.customer).toEqual({ name: 'Ana Prueba', phone: null })
    expect(h.tablas).toEqual([]); expect(h.upserts).toEqual([])
  })
  it('cliente con perfil permanente existente: Ventas NO lo recibe; formulario en blanco', async () => {
    render(<Caja />); agregar(); await elegirCliente(); pedirFactura()
    expect(await screen.findByTestId('form-fiscal')).toHaveTextContent('fiscal:vacío')
    await new Promise((r) => setTimeout(r, 30))
    expect(h.tablas).toEqual([]); expect(h.rpcs).toEqual([])
    expect(cobrar().disabled).toBe(true)
    const t = document.body.textContent ?? ''
    for (const s of [MAESTRO.rfc, MAESTRO.razon_social, MAESTRO.email_facturacion]) expect(t).not.toContain(s)
    expect(t).not.toContain('se guardan en su ficha')
  })
  it('cliente comercial con factura: cobra con el receptor capturado y NO escribe el perfil permanente', async () => {
    render(<Caja />); agregar(); await elegirCliente(); pedirFactura(); await llenar()
    fireEvent.click(cobrar()); await vendido()
    expect(h.upserts).toEqual([]); expect(h.tablas).toEqual([]); expect(h.rpcs).toEqual([])
    expect(h.ventas).toHaveLength(1)
    const o = h.ventas[0].opts
    expect(o.customerId).toBe(ID); expect(o.invoiceRequested).toBe(true); expect(o.invoiceMeta).toEqual({ receiver: CAPTURA }); expect(o.seller).toBe('lucia@ventas.test')
  })
  it('validación conservada: vacío o incompleto no cobra', async () => {
    render(<Caja />); agregar(); await elegirCliente(); pedirFactura()
    await screen.findByTestId('form-fiscal')
    for (const malo of [{ ...CAPTURA, rfc: 'MAL' }, { ...CAPTURA, regimen: '999' }, { ...CAPTURA, cp: '80' }, { ...CAPTURA, uso_cfdi: 'ZZZ' }, { ...CAPTURA, email_facturacion: 'no-es-correo' }, { ...CAPTURA, razon_social: '' }]) {
      h.captura = malo
      fireEvent.click(screen.getByTestId('form-fiscal'))
      expect(cobrar().disabled).toBe(true)
      fireEvent.click(cobrar())
    }
    expect(h.ventas).toHaveLength(0)
  })
  it('cambiar de cuenta no arrastra el receptor capturado para la anterior', async () => {
    render(<Caja />); agregar(); await elegirCliente(); pedirFactura(); await llenar()
    await elegirCliente({ id: ID2, name: 'Beto Otro', phone: null, mascara: null })
    await waitFor(() => expect(screen.getByTestId('form-fiscal')).toHaveTextContent('fiscal:vacío'))
    expect(cobrar().disabled).toBe(true); expect(h.tablas).toEqual([])
  })
  it('rechazo del servidor (autorización, sesión o cobro): visible, sin éxito, sin segundo intento ni vía alterna', async () => {
    for (const error of ['No tienes permiso para registrar esta venta.', 'Tu sesión terminó. Vuelve a iniciar sesión.', 'El pago fue rechazado.']) {
      cleanup(); h.ventas = []; h.respuestas = [{ ok: false, error }]
      render(<Caja />); agregar(); await elegirCliente(); pedirFactura(); await llenar()
      fireEvent.click(cobrar())
      await waitFor(() => expect(screen.getByText(error)).toBeTruthy())
      await new Promise((r) => setTimeout(r, 40))
      expect(screen.queryByText('Venta registrada')).toBeNull()
      expect(h.ventas).toHaveLength(1); expect(h.upserts).toEqual([]); expect(h.rpcs).toEqual([])
    }
  })
  it('otros roles sin permiso fiscal: mismo trato que Ventas', async () => {
    for (const rol of ['warehouse', 'driver', 'doctor']) {
      cleanup(); h.role = rol; h.tablas = []; h.upserts = []; h.ventas = []
      render(<Caja />); agregar(); await elegirCliente(); pedirFactura(); await llenar()
      fireEvent.click(cobrar()); await vendido()
      expect(h.tablas).toEqual([]); expect(h.upserts).toEqual([])
    }
  })
})

describe('SEC-C4-B5b · cobro: ambigüedad e idempotencia', () => {
  const AMBIGUA = { ok: false, ambiguous: true, error: 'No se pudo confirmar la venta. Revisa Ventas antes de cobrar de nuevo.' }
  it('respuesta ambigua: se dice, no hay segundo cobro automático; el reintento del usuario reusa la MISMA operación', async () => {
    h.respuestas = [AMBIGUA, exito()]
    render(<Caja />); agregar(); await elegirCliente(); pedirFactura(); await llenar()
    fireEvent.click(cobrar())
    await waitFor(() => expect(screen.getByText(AMBIGUA.error)).toBeTruthy())
    await new Promise((r) => setTimeout(r, 60))
    expect(h.ventas).toHaveLength(1); expect(screen.queryByText('Venta registrada')).toBeNull(); expect(screen.queryByText(/fallida/i)).toBeNull()
    fireEvent.click(cobrar()); await vendido()
    expect(h.ventas).toHaveLength(2)
    expect(h.ventas[1].opts.op).toEqual(h.ventas[0].opts.op)             // mismo order_id/folio → el servidor no duplica
    expect(h.ventas[1].opts.invoiceMeta).toEqual(h.ventas[0].opts.invoiceMeta)
    expect(h.estados).toEqual([]); expect(h.ops).toBe(1)
  })
  it('ambigua y luego cambia el receptor: primero verifica la anterior; si SÍ quedó, no cobra otra', async () => {
    h.respuestas = [AMBIGUA, exito()]; h.previa = true
    render(<Caja />); agregar(); pedirFactura(); await llenar()
    fireEvent.click(cobrar())
    await waitFor(() => expect(screen.getByText(AMBIGUA.error)).toBeTruthy())
    h.captura = { ...CAPTURA, razon_social: 'OTRA RAZON' }
    fireEvent.click(screen.getByTestId('form-fiscal'))
    fireEvent.click(cobrar())
    await waitFor(() => expect(screen.getByText(/SÍ quedó registrada/)).toBeTruthy())
    expect(h.estados).toEqual(['OP-1']); expect(h.ventas).toHaveLength(1)
  })
  it('doble clic mientras cobra: una sola venta', async () => {
    let soltar!: (v: unknown) => void
    h.respuestas = [new Promise((r) => { soltar = r })]
    render(<Caja />); agregar()
    fireEvent.click(cobrar()); fireEvent.click(cobrar()); fireEvent.click(cobrar())
    await waitFor(() => expect(h.ventas).toHaveLength(1))
    soltar(exito()); await vendido()
    expect(h.ventas).toHaveLength(1)
  })
})

describe('SEC-C4-B5b · Dirección conserva su flujo', () => {
  beforeEach(() => { h.role = 'admin' })
  it('cliente con factura: precarga el perfil, lo actualiza y cobra con ese receptor', async () => {
    render(<Caja />); agregar(); await elegirCliente(); pedirFactura()
    await waitFor(() => expect(screen.getByTestId('form-fiscal')).toHaveTextContent(`fiscal:${MAESTRO.rfc}`))
    expect(h.tablas).toEqual(['customers'])
    expect(screen.getByText(/se guardan en su ficha para futuras compras/)).toBeTruthy(); expect(screen.queryByTestId('caja-fiscal-solo-venta')).toBeNull()
    fireEvent.click(cobrar()); await vendido()
    expect(h.upserts).toEqual([[ID, MAESTRO]]); expect(h.ventas[0].opts.invoiceMeta).toEqual({ receiver: MAESTRO })
  })
  it('edición: el perfil permanente recibe lo editado antes del cobro', async () => {
    render(<Caja />); agregar(); await elegirCliente(); pedirFactura()
    await waitFor(() => expect(screen.getByTestId('form-fiscal')).toHaveTextContent(MAESTRO.rfc))
    fireEvent.click(screen.getByTestId('form-fiscal'))
    fireEvent.click(cobrar()); await vendido()
    expect(h.upserts).toEqual([[ID, CAPTURA]]); expect(h.ventas[0].opts.invoiceMeta).toEqual({ receiver: CAPTURA })
  })
  it('si el perfil no se pudo guardar, NO se cobra', async () => {
    h.respuestaUpsert = { ok: false, error: 'FISCAL_INVALIDO: RFC' }
    render(<Caja />); agregar(); await elegirCliente(); pedirFactura()
    await waitFor(() => expect(screen.getByTestId('form-fiscal')).toHaveTextContent(MAESTRO.rfc))
    fireEvent.click(cobrar())
    await waitFor(() => expect(screen.getByText('FISCAL_INVALIDO: RFC')).toBeTruthy())
    expect(h.ventas).toHaveLength(0); expect(screen.queryByText('Venta registrada')).toBeNull()
  })
  it('mostrador con factura y venta sin factura: sin perfil que leer o escribir', async () => {
    render(<Caja />); agregar(); pedirFactura(); await llenar()
    fireEvent.click(cobrar()); await vendido()
    expect(h.upserts).toEqual([]); expect(h.tablas).toEqual([]); expect(h.ventas[0].opts.invoiceMeta).toEqual({ receiver: CAPTURA })
    cleanup(); h.ventas = []
    render(<Caja />); agregar(); await elegirCliente()
    fireEvent.click(cobrar()); await vendido()
    expect(h.tablas).toEqual([]); expect(h.upserts).toEqual([]); expect(h.ventas[0].opts.invoiceRequested).toBe(false)
  })
})

describe('SEC-C4-B5b · guardas de fuente', () => {
  const c = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  it('lectura y escritura del perfil permanente solo para Dirección; una sola ruta de cobro', () => {
    expect(c).toMatch(/if \(esDireccion && hasSupabase && client\?\.id\) \{\s*const \{ data \} = await supabase\.from\('customers'\)\.select\('meta'\)/)
    expect(c).toMatch(/if \(esDireccion && client\?\.id\) \{\s*const saved = await upsertCustomerFiscal\(client\.id, fiscal\)/)
    expect(c.match(/\.from\(/g)).toHaveLength(1); expect(c.match(/upsertCustomerFiscal\(/g)).toHaveLength(1); expect(c.match(/venderPOS\(/g)).toHaveLength(1)
    for (const p of [/set_order_fiscal_snapshot|setOrderFiscalSnapshot/, /cliente_fiscal_guardar|customer_fiscal_profiles|cliente_perfiles_fiscales/, /service_role/, /console\./, /localStorage|sessionStorage/]) expect(c).not.toMatch(p)
  })
  it('la huella de idempotencia no cambió', () => {
    expect(c).toContain("const fp = JSON.stringify({ posLines, total, method, client: client?.id ?? null, invoiceReq, invoiceMeta })")
    expect(c).toContain('const op = posOpRef.current?.op ?? newPosOp()')
  })
})

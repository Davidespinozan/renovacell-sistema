// @vitest-environment jsdom
// SEC-C4-B5 · Nuevo pedido: DATOS FISCALES DEL PEDIDO ≠ PERFIL FISCAL PERMANENTE.
// Ventas captura el receptor solo para el pedido (sin leer ni escribir el expediente fiscal de la cuenta); el
// servidor lo congela en el pedido. Dirección conserva la precarga y la actualización del perfil. Datos falsos.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { isFiscalProfileComplete, type FiscalProfile } from '../../data/ops/fiscal'
import fuente from './NuevoPedido.tsx?raw'
import fuentePedidos from '../../data/store/ordersStore.ts?raw'

const MAESTRO = { rfc: 'MAE010101AB1', razon_social: 'PERFIL PERMANENTE SA', regimen: '601', cp: '80000', uso_cfdi: 'G03', email_facturacion: 'maestro@fiscal.test' }
const CAPTURA = { rfc: 'XAXX010101000', razon_social: 'CAPTURA DEL PEDIDO', regimen: '616', cp: '80010', uso_cfdi: 'S01', email_facturacion: 'captura@pedido.test' }

const h = vi.hoisted(() => ({
  role: 'pos', tablas: [] as string[], rpcs: [] as string[], upserts: [] as unknown[][], pedidos: [] as Array<Record<string, unknown>>,
  respuestaPedido: null as unknown, respuestaUpsert: { ok: true } as { ok: boolean; error?: string }, maestro: null as unknown, captura: null as unknown,
}))
vi.mock('../../auth/RoleContext', () => ({ useRole: () => ({ role: h.role, user: { name: 'Lucía' } }) }))
vi.mock('../../lib/supabase', () => {
  const cadena = (tabla: string) => { const c: Record<string, unknown> = {}; for (const k of ['select', 'eq']) c[k] = () => c; c.maybeSingle = async () => ({ data: tabla === 'customers' ? { id: 'CU-1', meta: { fiscal: h.maestro } } : null, error: null }); return c }
  return { hasSupabase: true, currentUserId: () => 'U-1', supabase: { from: (t: string) => { h.tablas.push(t); return cadena(t) }, rpc: async (fn: string) => { h.rpcs.push(fn); return { data: null, error: null } } } }
})
vi.mock('../../data/store/customersStore', () => ({
  customerFiscal: (c: { meta?: { fiscal?: unknown } } | null) => ({ rfc: '', razon_social: '', regimen: '', cp: '', uso_cfdi: '', email_facturacion: '', ...((c?.meta?.fiscal as object) ?? {}) }),
  upsertCustomerFiscal: async (...a: unknown[]) => { h.upserts.push(a); return h.respuestaUpsert },
}))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'P1', name: 'Producto Uno', price: 100, sellable: true }] }), isActiveProduct: () => true }))
vi.mock('../../data/hooks/useLots', () => ({ useLots: () => ({ data: [] }) }))
vi.mock('../../data/hooks/useVolumePrices', () => ({ useVolumePrices: () => ({ data: [] }) }))
vi.mock('../../data/ops/stock', () => ({ stockByProduct: () => ({}), stockInfoFor: () => ({ tracked: true, qty: 10, status: 'ok' }) }))
vi.mock('../../data/hooks/useOrders', () => ({ useOrders: () => ({ createOrder: async (i: Record<string, unknown>) => { h.pedidos.push(i); return h.respuestaPedido } }) }))
vi.mock('../../app/AddressPicker', () => ({ AddressPicker: ({ onChange }: { onChange: (a: unknown) => void }) => <button type="button" onClick={() => onChange({ line1: 'Calle 1', city: 'Culiacán', phone: '' })}>poner domicilio</button> }))
vi.mock('../../app/DeliveryLocationPicker', () => ({ DeliveryLocationPicker: ({ onChange }: { onChange: (a: unknown) => void }) => <button type="button" onClick={() => onChange({ address: { line1: 'Consultorio', city: 'Culiacán', phone: '' }, locationId: null })}>poner domicilio</button> }))
vi.mock('../../app/FiscalFields', () => ({
  FiscalFields: ({ onChange }: { onChange: (f: unknown) => void }) => <button type="button" data-testid="form-fiscal" onClick={() => onChange(h.captura)}>llenar fiscal</button>,
  FiscalSummary: ({ value }: { value: FiscalProfile }) => <div data-testid="resumen-fiscal">{value.rfc} {value.razon_social}</div>,
}))
import { NuevoPedido } from './NuevoPedido'

const CLIENTE = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana Prueba', phone: null }
const exito = (extra: object = {}) => ({ ok: true, order: { external_ref: 'S1001' }, ...extra })
const montar = (props: Partial<React.ComponentProps<typeof NuevoPedido>> = {}) => render(<NuevoPedido customer={CLIENTE} placedBy="Lucía (Ventas)" onClose={() => {}} {...props} />)
const boton = () => screen.getByRole('button', { name: /crear pedido|creando|guardando/i }) as HTMLButtonElement
const armar = () => { fireEvent.click(screen.getAllByRole('button').filter((b) => b.className === 'btn sm')[0]); fireEvent.click(screen.getByText('poner domicilio')) }
const pedirFactura = () => fireEvent.click(screen.getByRole('checkbox'))
const alerta = vi.fn()

beforeEach(() => {
  cleanup(); h.role = 'pos'; h.tablas = []; h.rpcs = []; h.upserts = []; h.pedidos = []; h.respuestaPedido = exito(); h.respuestaUpsert = { ok: true }
  h.maestro = MAESTRO; h.captura = CAPTURA; alerta.mockReset(); window.alert = alerta
})

describe('SEC-C4-B5 · Ventas · pedido sin factura', () => {
  it('crea el pedido con identificador y nombre de la cuenta; sin lecturas ni escrituras del expediente', async () => {
    montar(); armar()
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.pedidos).toHaveLength(1)
    const p = h.pedidos[0]
    expect(p.customer_id).toBe(CLIENTE.id); expect(p.customer).toEqual({ name: 'Ana Prueba', phone: null })
    expect(p.invoice_requested).toBe(false); expect(p.receiver).toBeNull(); expect(p.placedBy).toBe('Lucía (Ventas)')
    expect(p).not.toHaveProperty('doctor_id'); expect(p).not.toHaveProperty('seller'); expect(p).not.toHaveProperty('seller_id')
    expect(p.lines).toEqual([{ product_id: 'P1', qty: 1, unit_price: 100 }])
    expect(h.tablas).toEqual([]); expect(h.rpcs).toEqual([]); expect(h.upserts).toEqual([])
  })
  it('rechazo del servidor: se muestra y NO se anuncia éxito', async () => {
    h.respuestaPedido = { ok: false, error: 'No tienes permiso para levantar este pedido.', ambiguous: false }
    montar(); armar()
    fireEvent.click(boton())
    expect(await screen.findByRole('alert')).toHaveTextContent('El pedido no se creó. No tienes permiso')
    expect(screen.queryByText('Pedido creado')).toBeNull()
    expect(h.pedidos).toHaveLength(1)                       // sin reintento automático
  })
  it('sin productos o sin domicilio no hay solicitud', () => {
    montar()
    expect(boton().disabled).toBe(true)
    fireEvent.click(boton())
    expect(h.pedidos).toHaveLength(0)
  })
})

describe('SEC-C4-B5 · Ventas · pedido con factura (captura solo para el pedido)', () => {
  it('pedir factura NO consulta el perfil fiscal de la cuenta: formulario en blanco y aviso', async () => {
    montar(); armar(); pedirFactura()
    expect(await screen.findByTestId('form-fiscal')).toBeTruthy()
    expect(screen.getByTestId('np-fiscal-solo-pedido')).toHaveTextContent('solo en este pedido')
    expect(screen.getByText('Datos fiscales para este pedido')).toBeTruthy()
    expect(h.tablas).toEqual([]); expect(h.rpcs).toEqual([])
    const t = document.body.textContent ?? ''
    for (const s of [MAESTRO.rfc, MAESTRO.razon_social, MAESTRO.email_facturacion]) expect(t).not.toContain(s)
    expect(screen.queryByTestId('resumen-fiscal')).toBeNull(); expect(screen.queryByText('Editar')).toBeNull()
  })
  it('validación fiscal conservada: incompleto no crea el pedido', async () => {
    montar(); armar(); pedirFactura()
    await screen.findByTestId('form-fiscal')
    expect(boton().disabled).toBe(true)
    h.captura = { ...CAPTURA, rfc: 'MAL' }
    fireEvent.click(screen.getByTestId('form-fiscal'))
    expect(boton().disabled).toBe(true)
    fireEvent.click(boton())
    expect(h.pedidos).toHaveLength(0)
  })
  it('captura completa: el receptor viaja SOLO en el pedido; el perfil permanente no se escribe', async () => {
    expect(isFiscalProfileComplete(CAPTURA)).toBe(true)
    montar(); armar(); pedirFactura()
    fireEvent.click(await screen.findByTestId('form-fiscal'))
    await waitFor(() => expect(boton().disabled).toBe(false))
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.upserts).toEqual([])                           // NO upsert_customer_fiscal
    expect(h.tablas).toEqual([]); expect(h.rpcs).toEqual([])
    expect(h.pedidos[0].invoice_requested).toBe(true); expect(h.pedidos[0].receiver).toEqual(CAPTURA)
    expect(h.pedidos[0].customer_id).toBe(CLIENTE.id)
    expect(screen.queryByTestId('np-fiscal-pendiente')).toBeNull()
  })
  it('el servidor creó el pedido pero NO guardó el receptor: se dice, sin anunciar la factura como lista', async () => {
    h.respuestaPedido = exito({ fiscalPendiente: true })
    montar(); armar(); pedirFactura()
    fireEvent.click(await screen.findByTestId('form-fiscal'))
    await waitFor(() => expect(boton().disabled).toBe(false))
    fireEvent.click(boton())
    expect(await screen.findByTestId('np-fiscal-pendiente')).toHaveTextContent('NO quedaron guardados')
    expect(screen.getByTestId('np-fiscal-pendiente')).toHaveTextContent('S1001')
  })
  it('rechazo del servidor con factura: sin éxito y sin escritura alterna', async () => {
    h.respuestaPedido = { ok: false, error: 'NO_AUTORIZADO', ambiguous: false }
    montar(); armar(); pedirFactura()
    fireEvent.click(await screen.findByTestId('form-fiscal'))
    await waitFor(() => expect(boton().disabled).toBe(false))
    fireEvent.click(boton())
    expect(await screen.findByRole('alert')).toHaveTextContent('El pedido no se creó')
    expect(h.upserts).toEqual([]); expect(h.rpcs).toEqual([]); expect(h.pedidos).toHaveLength(1)
  })
  it('otra cuenta (pantalla nueva): no arrastra los datos fiscales capturados para la anterior', async () => {
    const a = montar(); armar(); pedirFactura()
    fireEvent.click(await screen.findByTestId('form-fiscal'))
    await waitFor(() => expect(boton().disabled).toBe(false))
    a.unmount()
    montar({ customer: { id: '22222222-2222-4222-8222-222222222222', name: 'Beto Otro', phone: null } }); armar(); pedirFactura()
    await screen.findByTestId('form-fiscal')
    expect(boton().disabled).toBe(true)                     // en blanco otra vez
    expect(h.pedidos).toHaveLength(0)
  })
  it('otros roles sin permiso fiscal: mismo trato que Ventas (ni lectura ni escritura)', async () => {
    for (const rol of ['warehouse', 'driver', 'doctor']) {
      cleanup(); h.role = rol; h.tablas = []; h.upserts = []
      montar(); armar(); pedirFactura()
      await screen.findByTestId('form-fiscal')
      expect(h.tablas).toEqual([]); expect(h.upserts).toEqual([])
    }
  })
})

describe('SEC-C4-B5 · Dirección conserva su flujo', () => {
  beforeEach(() => { h.role = 'admin' })
  it('precarga el perfil permanente y lo usa como receptor sin reescribirlo', async () => {
    montar({ placedBy: 'Administración' }); armar(); pedirFactura()
    expect(await screen.findByTestId('resumen-fiscal')).toHaveTextContent(MAESTRO.rfc)
    expect(h.tablas).toEqual(['customers'])
    expect(screen.getByText('Datos fiscales del cliente')).toBeTruthy(); expect(screen.queryByTestId('np-fiscal-solo-pedido')).toBeNull()
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.upserts).toEqual([]); expect(h.pedidos[0].receiver).toEqual(MAESTRO)
  })
  it('editar: actualiza el perfil permanente de ESA cuenta y luego crea el pedido', async () => {
    montar({ placedBy: 'Administración' }); armar(); pedirFactura()
    await screen.findByTestId('resumen-fiscal')
    fireEvent.click(screen.getByText('Editar'))
    fireEvent.click(screen.getByTestId('form-fiscal'))
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.upserts).toEqual([[CLIENTE.id, CAPTURA]]); expect(h.pedidos[0].receiver).toEqual(CAPTURA)
  })
  it('si el perfil permanente no se pudo guardar, el pedido NO se crea', async () => {
    h.respuestaUpsert = { ok: false, error: 'FISCAL_INVALIDO' }
    montar({ placedBy: 'Administración' }); armar(); pedirFactura()
    await screen.findByTestId('resumen-fiscal')
    fireEvent.click(screen.getByText('Editar')); fireEvent.click(screen.getByTestId('form-fiscal'))
    fireEvent.click(boton())
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('FISCAL_INVALIDO'))
    expect(h.pedidos).toHaveLength(0); expect(screen.queryByText('Pedido creado')).toBeNull()
  })
  it('pedido a nombre de un doctor: sin cambios (precarga por perfil, doctor_id)', async () => {
    render(<NuevoPedido doctor={{ id: '33333333-3333-4333-8333-333333333333', name: 'Dra. Portal' }} placedBy="Administración" onClose={() => {}} />)
    armar(); pedirFactura()
    expect(await screen.findByTestId('resumen-fiscal')).toHaveTextContent(MAESTRO.rfc)
    fireEvent.click(boton())
    await waitFor(() => expect(screen.getByText('Pedido creado')).toBeTruthy())
    expect(h.pedidos[0].doctor_id).toBe('33333333-3333-4333-8333-333333333333'); expect(h.pedidos[0]).not.toHaveProperty('customer_id')
  })
})

describe('SEC-C4-B5 · guardas de fuente', () => {
  const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  it('lecturas y escritura del perfil permanente quedan detrás de Dirección; sin directorio, consola ni almacenamiento', () => {
    const c = codigo(fuente)
    expect(c).toMatch(/const fiscalPermanente = role === 'admin'/)
    expect(c).toMatch(/if \(invoice && fiscalPermanente && fiscalCustomerId && editingFiscal\)/)
    expect(c.indexOf('if (!fiscalPermanente) {')).toBeGreaterThan(0)
    expect(c.indexOf('if (!fiscalPermanente) {')).toBeLessThan(c.indexOf(".from('customers')"))
    expect(c.match(/upsertCustomerFiscal\(/g)).toHaveLength(1)
    for (const p of [/useCustomers|listCustomers/, /service_role/, /console\./, /localStorage|sessionStorage/, /cliente_fiscal_guardar|customer_fiscal_profiles/]) expect(c).not.toMatch(p)
  })
  it('crear el pedido no envía vendedor ni precios autoritativos nuevos; el fallo del receptor se devuelve marcado', () => {
    const p = codigo(fuentePedidos)
    expect(p).toMatch(/return \{ ok: true, order: creado, fiscalPendiente: true \}/)
    expect(p).toMatch(/rpc\('set_order_fiscal_snapshot', \{ p_order_id: id, p_receiver: normalizeFiscalProfile\(input\.receiver\) \}\)/)
    expect(p).not.toMatch(/upsert_customer_fiscal/)
  })
})
